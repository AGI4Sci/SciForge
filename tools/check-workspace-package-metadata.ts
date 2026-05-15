import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';

type RootPackageJson = {
  workspaces?: string[] | { packages?: string[] };
};

type WorkspacePackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  exports?: unknown;
  sciforge?: SciForgeMetadata;
};

type SciForgeMetadata = {
  lifecycleLayer?: string;
  skillFacing?: boolean;
  skillKinds?: unknown;
  sideEffects?: unknown;
  publicContract?: boolean;
  runtimeAdapter?: boolean;
};

type PackageRecord = {
  path: string;
  dir: string;
  workspacePattern?: string;
  discoverableBy?: string;
  manifest: WorkspacePackageJson;
};

const packageRoot = 'packages';
const allowedLifecycleLayers = new Set([
  'contracts',
  'reasoning',
  'skills',
  'observe',
  'actions',
  'verifiers',
  'presentation',
  'scenarios',
  'support',
  'tools',
  'workers',
]);
const allowedSideEffects = new Set(['none', 'delegated-to-actions', 'runtime', 'build-time', 'network']);
const failures: string[] = [];

const rootPackageJson = await readJson<RootPackageJson>('package.json');
const workspacePatterns = normalizeWorkspacePatterns(rootPackageJson.workspaces);
const packages = await discoverPackageJson(packageRoot);
const records: PackageRecord[] = await Promise.all(packages.map(async (path) => ({
  path,
  dir: dirname(path),
  manifest: await readJson<WorkspacePackageJson>(path),
})));

const recordsByDir = new Map(records.map((record) => [record.dir, record]));
const packageNames = new Map<string, string>();

for (const record of records) {
  record.workspacePattern = workspacePatterns.find((pattern) => workspacePatternMatches(pattern, record.dir));
  record.discoverableBy = findDiscoverableAncestor(record);

  requireString(record.manifest.name, `${record.path} must declare package name`);
  requireString(record.manifest.version, `${record.path} must declare package version`);

  if (record.manifest.name) {
    const existingPath = packageNames.get(record.manifest.name);
    if (existingPath) {
      failures.push(`${record.path} duplicates package name ${record.manifest.name} from ${existingPath}`);
    }
    packageNames.set(record.manifest.name, record.path);
  }

  if (record.manifest.version && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(record.manifest.version)) {
    failures.push(`${record.path} version ${record.manifest.version} must look like semver`);
  }

  if (!record.workspacePattern && !record.discoverableBy) {
    failures.push(`${record.path} must be covered by root package.json workspaces or discoverable from a covered SciForge parent package`);
  }

  const metadataOwner = record.manifest.sciforge ? record : findSciForgeAncestor(record);
  if (!metadataOwner) {
    failures.push(`${record.path} must declare sciforge metadata or inherit it from a parent workspace package`);
  }

  if (record.manifest.sciforge) {
    validateSciForgeMetadata(record.path, record.manifest.sciforge);
  }

  if (isExactWorkspacePackage(record)) {
    requireSciForgeMetadata(record);
  }
}

if (failures.length) {
  console.error([
    'Workspace package metadata check failed:',
    ...failures.map((failure) => `- ${failure}`),
  ].join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    packages: records.length,
    workspacePatterns: workspacePatterns.length,
    packagesWithOwnMetadata: records.filter((record) => record.manifest.sciforge).length,
    packagesWithInheritedMetadata: records.filter((record) => !record.manifest.sciforge && findSciForgeAncestor(record)).length,
  }, null, 2));
}

async function discoverPackageJson(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await discoverPackageJson(path));
      continue;
    }
    if (entry.isFile() && entry.name === 'package.json') files.push(path);
  }
  return files.sort();
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function normalizeWorkspacePatterns(workspaces: RootPackageJson['workspaces']): string[] {
  const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages ?? [];
  return patterns.map(toPosixPath).filter((pattern) => pattern.startsWith(`${packageRoot}/`));
}

function workspacePatternMatches(pattern: string, dir: string): boolean {
  const patternParts = pattern.split('/');
  const dirParts = toPosixPath(dir).split('/');
  if (patternParts.length !== dirParts.length) return false;
  return patternParts.every((part, index) => part === '*' || part === dirParts[index]);
}

function isExactWorkspacePackage(record: PackageRecord): boolean {
  return record.workspacePattern === record.dir;
}

function findSciForgeAncestor(record: PackageRecord): PackageRecord | undefined {
  return findAncestorPackage(record, (ancestor) => Boolean(ancestor.manifest.sciforge));
}

function findDiscoverableAncestor(record: PackageRecord): string | undefined {
  const ancestor = findAncestorPackage(record, (candidate) => {
    if (!candidate.workspacePattern || !candidate.manifest.sciforge) return false;
    const childDir = toPosixPath(relative(candidate.dir, record.dir));
    if (!childDir || childDir.startsWith('..')) return false;
    return packageExportsChild(candidate.manifest.exports, childDir) || packageFilesChild(candidate.manifest.files, childDir);
  });
  return ancestor?.path;
}

function findAncestorPackage(record: PackageRecord, predicate: (record: PackageRecord) => boolean): PackageRecord | undefined {
  let current = toPosixPath(dirname(record.dir));
  while (current && current !== '.' && current !== record.dir) {
    const ancestor = recordsByDir.get(current);
    if (ancestor && predicate(ancestor)) return ancestor;
    const next = toPosixPath(dirname(current));
    if (next === current) break;
    current = next;
  }
  return undefined;
}

function packageExportsChild(exportsField: unknown, childDir: string): boolean {
  const exportKeys = typeof exportsField === 'object' && exportsField !== null && !Array.isArray(exportsField)
    ? Object.keys(exportsField)
    : [];
  const firstSegment = childDir.split('/')[0];
  return exportKeys.some((key) => (
    key.startsWith(`./${firstSegment}/`) ||
    key.startsWith('./*/') ||
    key === `./${firstSegment}`
  ));
}

function packageFilesChild(files: string[] | undefined, childDir: string): boolean {
  if (!files?.length) return false;
  const firstSegment = childDir.split('/')[0];
  return files.some((entry) => (
    entry === childDir ||
    entry.startsWith(`${firstSegment}/`) ||
    entry.startsWith('*/')
  ));
}

function requireSciForgeMetadata(record: PackageRecord) {
  if (!record.manifest.sciforge) {
    failures.push(`${record.path} is an exact workspace package and must declare sciforge metadata`);
    return;
  }
  validateSciForgeMetadata(record.path, record.manifest.sciforge);
}

function validateSciForgeMetadata(path: string, metadata: SciForgeMetadata) {
  if (!allowedLifecycleLayers.has(metadata.lifecycleLayer ?? '')) {
    failures.push(`${path} sciforge.lifecycleLayer must be one of ${Array.from(allowedLifecycleLayers).join(', ')}`);
  }
  if (typeof metadata.skillFacing !== 'boolean') {
    failures.push(`${path} sciforge.skillFacing must be boolean`);
  }
  if (typeof metadata.publicContract !== 'boolean') {
    failures.push(`${path} sciforge.publicContract must be boolean`);
  }
  if (typeof metadata.runtimeAdapter !== 'boolean') {
    failures.push(`${path} sciforge.runtimeAdapter must be boolean`);
  }
  if (!allowedSideEffects.has(String(metadata.sideEffects))) {
    failures.push(`${path} sciforge.sideEffects must be one of ${Array.from(allowedSideEffects).join(', ')}`);
  }
  if (metadata.skillFacing === true && !Array.isArray(metadata.skillKinds)) {
    failures.push(`${path} sciforge.skillKinds must be listed when skillFacing is true`);
  }
}

function requireString(value: string | undefined, message: string) {
  if (!value?.trim()) failures.push(message);
}

function toPosixPath(path: string) {
  return path.split(sep).join('/');
}
