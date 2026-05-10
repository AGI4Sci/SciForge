import { pathToFileURL } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  validateCapabilityManifestShape,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';
import type {
  CapabilityProviderAvailabilityInput,
  PackageCapabilityManifestDiscoveryEntry,
  PackageCapabilityManifestDiscoveryResult,
} from './capability-manifest-registry.js';

export interface CapabilityManifestFileDiscoveryInput {
  rootDir: string;
  maxDepth?: number;
  candidateFileNames?: string[];
  ignoredDirNames?: string[];
}

export interface CapabilityManifestFileDiscoveryAudit {
  contract: 'sciforge.capability-manifest-file-discovery-audit.v1';
  rootDir: string;
  filesScanned: number;
  manifestCount: number;
  packageCount: number;
  entries: CapabilityManifestFileDiscoveryAuditEntry[];
}

export interface CapabilityManifestFileDiscoveryAuditEntry {
  filePath: string;
  packageName?: string;
  packageRoot?: string;
  status: 'loaded' | 'skipped' | 'failed';
  manifestIds: string[];
  reason?: string;
}

export interface CapabilityManifestFileDiscoveryResult extends PackageCapabilityManifestDiscoveryResult {
  audit: CapabilityManifestFileDiscoveryAudit;
}

interface DiscoveredManifestFile {
  filePath: string;
  manifests: CapabilityManifest[];
  providerAvailability?: CapabilityProviderAvailabilityInput[];
}

interface PackageJsonSummary {
  packageName?: string;
  packageRoot?: string;
}

const DEFAULT_CANDIDATE_FILE_NAMES = [
  'capability.manifest.json',
  'capability-manifest.json',
  'manifest.json',
  'capability.manifest.ts',
  'capability-manifest.ts',
  'manifest.ts',
];

const DEFAULT_IGNORED_DIR_NAMES = ['.git', 'node_modules', 'dist', 'build', 'coverage', '.turbo', '.next'];

export async function discoverPackageCapabilityManifestsFromFiles(
  input: CapabilityManifestFileDiscoveryInput,
): Promise<CapabilityManifestFileDiscoveryResult> {
  const rootDir = path.resolve(input.rootDir);
  const candidateFileNames = new Set(input.candidateFileNames ?? DEFAULT_CANDIDATE_FILE_NAMES);
  const ignoredDirNames = new Set(input.ignoredDirNames ?? DEFAULT_IGNORED_DIR_NAMES);
  const candidateFiles = await listCandidateManifestFiles({
    rootDir,
    candidateFileNames,
    ignoredDirNames,
    maxDepth: input.maxDepth ?? 8,
  });
  const packageJsonCache = new Map<string, Promise<PackageJsonSummary>>();
  const entries: CapabilityManifestFileDiscoveryAuditEntry[] = [];
  const packageEntries = new Map<string, PackageCapabilityManifestDiscoveryEntry>();

  for (const filePath of candidateFiles) {
    const loaded = await loadManifestFile(filePath);
    if (loaded.manifests.length === 0) {
      entries.push({
        filePath: path.relative(rootDir, filePath),
        status: loaded.reason ? 'failed' : 'skipped',
        manifestIds: [],
        ...(loaded.reason ? { reason: loaded.reason } : { reason: 'no CapabilityManifest export found' }),
      });
      continue;
    }

    const packageSummary = await nearestPackageJsonSummary(path.dirname(filePath), rootDir, packageJsonCache);
    const fallbackPackageName = loaded.manifests[0]?.ownerPackage ?? path.basename(path.dirname(filePath));
    const packageName = packageSummary.packageName ?? fallbackPackageName;
    const packageRoot = packageSummary.packageRoot ?? path.relative(rootDir, path.dirname(filePath));
    const packageKey = `${packageName}\0${packageRoot}`;
    const existing = packageEntries.get(packageKey) ?? {
      packageName,
      packageRoot,
      manifests: [],
      providerAvailability: [],
      discoverySource: 'file-discovery',
    };
    existing.manifests.push(...loaded.manifests);
    existing.providerAvailability?.push(...(loaded.providerAvailability ?? []));
    packageEntries.set(packageKey, existing);
    entries.push({
      filePath: path.relative(rootDir, filePath),
      packageName,
      packageRoot,
      status: 'loaded',
      manifestIds: loaded.manifests.map((manifest) => manifest.id),
    });
  }

  const packages = [...packageEntries.values()].map((entry) => ({
    ...entry,
    providerAvailability: entry.providerAvailability && entry.providerAvailability.length > 0
      ? entry.providerAvailability
      : undefined,
  }));

  return {
    packages,
    audit: {
      contract: 'sciforge.capability-manifest-file-discovery-audit.v1',
      rootDir,
      filesScanned: candidateFiles.length,
      manifestCount: packages.reduce((total, entry) => total + entry.manifests.length, 0),
      packageCount: packages.length,
      entries,
    },
  };
}

async function listCandidateManifestFiles(input: {
  rootDir: string;
  candidateFileNames: Set<string>;
  ignoredDirNames: Set<string>;
  maxDepth: number;
}) {
  const result: string[] = [];
  await walkDir(input.rootDir, 0);
  return result.sort((left, right) => left.localeCompare(right));

  async function walkDir(dirPath: string, depth: number): Promise<void> {
    if (depth > input.maxDepth) return;
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!input.ignoredDirNames.has(entry.name)) await walkDir(entryPath, depth + 1);
        continue;
      }
      if (entry.isFile() && input.candidateFileNames.has(entry.name)) result.push(entryPath);
    }
  }
}

async function loadManifestFile(filePath: string): Promise<DiscoveredManifestFile & { reason?: string }> {
  try {
    const payload = filePath.endsWith('.json')
      ? JSON.parse(await readFile(filePath, 'utf8'))
      : await import(`${pathToFileURL(filePath).href}?capabilityManifestDiscovery=${Date.now()}`);
    const candidates = extractManifestCandidates(payload);
    const manifests = candidates.filter(isValidCapabilityManifest);
    return {
      filePath,
      manifests,
      providerAvailability: extractProviderAvailability(payload),
    };
  } catch (error) {
    return {
      filePath,
      manifests: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractManifestCandidates(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const directCandidates = [
    payload,
    payload.default,
    payload.manifest,
    payload.capabilityManifest,
  ];
  return [
    ...directCandidates,
    ...arrayValue(payload.manifests),
    ...arrayValue(payload.capabilityManifests),
    ...arrayValue(isRecord(payload.default) ? payload.default.manifests : undefined),
    ...arrayValue(isRecord(payload.default) ? payload.default.capabilityManifests : undefined),
  ];
}

function extractProviderAvailability(payload: unknown): CapabilityProviderAvailabilityInput[] | undefined {
  if (!isRecord(payload)) return undefined;
  const fromPayload = arrayValue(payload.providerAvailability);
  const fromDefault = isRecord(payload.default) ? arrayValue(payload.default.providerAvailability) : [];
  const availability = [...fromPayload, ...fromDefault].filter(isProviderAvailabilityInput);
  return availability.length > 0 ? availability : undefined;
}

function isValidCapabilityManifest(value: unknown): value is CapabilityManifest {
  return isRecord(value)
    && value.contract === 'sciforge.capability-manifest.v1'
    && validateCapabilityManifestShape(value as unknown as CapabilityManifest).length === 0;
}

function isProviderAvailabilityInput(value: unknown): value is CapabilityProviderAvailabilityInput {
  if (typeof value === 'string') return value.trim().length > 0;
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.available === 'boolean'
    && (value.reason === undefined || typeof value.reason === 'string');
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function nearestPackageJsonSummary(
  startDir: string,
  rootDir: string,
  cache: Map<string, Promise<PackageJsonSummary>>,
): Promise<PackageJsonSummary> {
  let current = path.resolve(startDir);
  while (current.startsWith(rootDir)) {
    const packageJsonPath = path.join(current, 'package.json');
    if (!cache.has(packageJsonPath)) cache.set(packageJsonPath, readPackageJsonSummary(packageJsonPath, rootDir));
    const summary = await cache.get(packageJsonPath)!;
    if (summary.packageName) return summary;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return {};
}

async function readPackageJsonSummary(packageJsonPath: string, rootDir: string): Promise<PackageJsonSummary> {
  try {
    const payload = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    if (!isRecord(payload) || typeof payload.name !== 'string' || payload.name.trim().length === 0) return {};
    return {
      packageName: payload.name,
      packageRoot: path.relative(rootDir, path.dirname(packageJsonPath)),
    };
  } catch {
    return {};
  }
}
