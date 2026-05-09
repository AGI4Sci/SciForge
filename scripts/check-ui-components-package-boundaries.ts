import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { uiComponentManifests } from '../packages/presentation/components';
import type { UIComponentManifest } from '../packages/presentation/components';

// UI component publication checks live here. The generic package catalog smoke
// only validates manifest discovery, while module-boundaries owns import graph
// violations across src/ui and packages.

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  exports?: string | Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type Finding = {
  component: string;
  message: string;
};

type Severity = 'error' | 'warn';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uiRoot = join(repoRoot, 'packages/presentation/components');
const aggregatePackageJson = await readPackageJson('@sciforge-ui/components', uiRoot);
const componentDirNames = await discoverComponentDirs();
const exportedManifestIds = new Set(uiComponentManifests.map((manifest) => manifest.componentId));
const componentNames = new Set(componentDirNames);
const errors: Finding[] = [];
const warnings: Finding[] = [];

checkAggregatePackageBoundary(aggregatePackageJson);

for (const component of componentDirNames) {
  const dir = join(uiRoot, component);
  const manifest = await readManifest(component, dir);
  const packageJson = await readPackageJson(component, dir);
  const severity = publicationSeverity(manifest);

  requireFile(component, dir, 'package.json', severity);
  requireFile(component, dir, 'README.md', severity);
  requireFile(component, dir, 'manifest.ts', 'error');

  if (manifest) {
    if (!exportedManifestIds.has(component)) {
      report(component, 'manifest.ts is not exported from packages/presentation/components/index.ts', publicationSeverity(manifest));
    }
    if (packageJson?.name !== manifest.packageName) {
      report(component, `package.json name must match manifest packageName (${manifest.packageName})`, publicationSeverity(manifest));
    }
    if (packageJson?.version !== manifest.version) {
      report(component, `package.json version must match manifest version (${manifest.version})`, publicationSeverity(manifest));
    }
    if (packageJson?.private === true) {
      report(component, 'component packages must be publishable and must not set private: true', publicationSeverity(manifest));
    }
    if (!declaresDependency(packageJson, '@sciforge-ui/runtime-contract')) {
      report(component, 'package.json must declare @sciforge-ui/runtime-contract as a dependency or peerDependency', publicationSeverity(manifest));
    }
    if (manifest.docs?.readmePath !== `packages/presentation/components/${component}/README.md`) {
      report(component, `manifest docs.readmePath should be packages/presentation/components/${component}/README.md`, publicationSeverity(manifest));
    }
  }

  await checkReadme(component, dir);
  checkPackageBoundary(component, dir, packageJson, manifest);
  await checkFixtures(component, dir, manifest);
  await checkImports(component, dir);
}

for (const manifest of uiComponentManifests) {
  if (!componentNames.has(manifest.componentId)) {
    warn(manifest.componentId, 'manifest is exported but no matching component directory exists');
  }
}

printResults();

async function discoverComponentDirs() {
  const entries = await readdir(uiRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(uiRoot, name, 'package.json')) || existsSync(join(uiRoot, name, 'manifest.ts')))
    .sort();
}

async function readPackageJson(component: string, dir: string): Promise<PackageJson | undefined> {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PackageJson;
  } catch (cause) {
    error(component, `package.json must be valid JSON: ${String(cause)}`);
    return undefined;
  }
}

async function readManifest(component: string, dir: string): Promise<UIComponentManifest | undefined> {
  const path = join(dir, 'manifest.ts');
  if (!existsSync(path)) return undefined;
  try {
    const module = await import(pathToFileURL(path).href) as { manifest?: UIComponentManifest };
    if (!module.manifest) {
      error(component, 'manifest.ts must export const manifest');
      return undefined;
    }
    if (module.manifest.componentId !== component) {
      error(component, `manifest componentId must match directory name (${component})`);
    }
    return module.manifest;
  } catch (cause) {
    error(component, `manifest.ts must be importable: ${String(cause)}`);
    return undefined;
  }
}

function requireFile(component: string, dir: string, file: string, severity: Severity) {
  if (!existsSync(join(dir, file))) report(component, `missing required ${file}`, severity);
}

async function checkReadme(component: string, dir: string) {
  const readmePath = join(dir, 'README.md');
  if (!existsSync(readmePath)) return;
  const readme = await readFile(readmePath, 'utf8');
  if (!/##\s+Agent quick contract\b/.test(readme)) {
    error(component, 'README.md must include "## Agent quick contract"');
  }
  if (!readme.includes(component)) {
    warn(component, 'README.md should mention the component id for agent-facing disambiguation');
  }
}

function checkPackageBoundary(component: string, dir: string, packageJson?: PackageJson, manifest?: UIComponentManifest) {
  if (!packageJson) return;
  const files = packageJson.files ?? [];
  const exports = packageJson.exports;
  const renderPath = firstExisting(join(dir, 'render.tsx'), join(dir, 'src/render.tsx'));
  const renderPackagePath = renderPath ? relative(dir, renderPath).replace(/\\/g, '/') : undefined;
  const hasAssets = existsSync(join(dir, 'assets'));
  const hasWorkbenchDemo = existsSync(join(dir, 'workbench-demo'));
  const severity = publicationSeverity(manifest);

  requireFilesEntry(component, files, 'README.md');
  requireFilesEntry(component, files, 'package.json');
  requireFilesEntry(component, files, 'manifest.ts');
  requireFilesEntry(component, files, 'fixtures');
  if (renderPackagePath) requireFilesEntry(component, files, renderPackagePath);
  if (hasAssets) requireFilesEntry(component, files, 'assets');
  if (hasWorkbenchDemo) requireFilesEntry(component, files, 'workbench-demo');

  requireExport(component, exports, '.', 'manifest entry');
  requireExport(component, exports, './manifest', 'manifest subpath');
  requireExport(component, exports, './README.md', 'README subpath');
  requireExport(component, exports, './fixtures/basic', 'basic fixture subpath');
  requireExport(component, exports, './fixtures/empty', 'empty fixture subpath');
  if (existsSync(join(dir, 'fixtures/selection.ts')) || existsSync(join(dir, 'fixtures/selection.json'))) {
    requireExport(component, exports, './fixtures/selection', 'selection fixture subpath');
  }
  if (renderPackagePath) requireExport(component, exports, './render', 'renderer subpath');
  if (hasAssets) requireWildcardExport(component, exports, './assets/', 'assets wildcard subpath');
  if (hasWorkbenchDemo) requireWildcardExport(component, exports, './workbench-demo/', 'workbench demo asset subpath');

  function requireFilesEntry(component: string, files: string[], expected: string) {
    if (!files.some((entry) => coversPackagePath(entry, expected))) {
      report(component, `package.json files must include ${expected}`, severity);
    }
  }

  function requireExport(component: string, exports: PackageJson['exports'], key: string, label: string) {
    if (!hasExport(exports, key)) report(component, `package.json exports must include ${key} (${label})`, severity);
  }

  function requireWildcardExport(component: string, exports: PackageJson['exports'], prefix: string, label: string) {
    if (!hasWildcardExport(exports, prefix)) report(component, `package.json exports must include ${prefix}* (${label})`, severity);
  }
}

function checkAggregatePackageBoundary(packageJson?: PackageJson) {
  if (!packageJson) {
    error('@sciforge-ui/components', 'missing aggregate package.json');
    return;
  }

  if (packageJson.name !== '@sciforge-ui/components') {
    error('@sciforge-ui/components', 'aggregate package name must be @sciforge-ui/components');
  }
  if (packageJson.private === true) {
    error('@sciforge-ui/components', 'aggregate package must be publishable and must not set private: true');
  }

  const files = packageJson.files ?? [];
  const exports = packageJson.exports;
  for (const expected of [
    'README.md',
    'index.ts',
    'types.ts',
    'package.json',
    '*/README.md',
    '*/manifest.ts',
    '*/render.tsx',
    '*/fixtures/*',
    '*/assets/*',
    '*/workbench-demo/*',
  ]) {
    if (!files.includes(expected)) {
      error('@sciforge-ui/components', `aggregate package.json files must include ${expected}`);
    }
  }

  for (const [key, label] of [
    ['.', 'manifest index'],
    ['./types', 'shared types'],
    ['./*/manifest', 'component manifest wildcard'],
    ['./*/README.md', 'component README wildcard'],
    ['./*/fixtures/basic', 'basic fixture wildcard'],
    ['./*/fixtures/empty', 'empty fixture wildcard'],
    ['./*/fixtures/selection', 'selection fixture wildcard'],
    ['./*/render', 'renderer wildcard'],
    ['./*/assets/*', 'assets wildcard'],
    ['./*/workbench-demo/*', 'workbench demo wildcard'],
  ] as const) {
    if (!hasExport(exports, key)) {
      error('@sciforge-ui/components', `aggregate package.json exports must include ${key} (${label})`);
    }
  }
}

function coversPackagePath(entry: string, expected: string) {
  const normalizedEntry = entry.replace(/\\/g, '/').replace(/\/\*\*?$/, '');
  const normalizedExpected = expected.replace(/\\/g, '/');
  return normalizedEntry === normalizedExpected || normalizedExpected.startsWith(`${normalizedEntry}/`);
}

function hasExport(exports: PackageJson['exports'], key: string) {
  if (typeof exports === 'string') return key === '.';
  return Boolean(exports && Object.hasOwn(exports, key));
}

function hasWildcardExport(exports: PackageJson['exports'], prefix: string) {
  if (!exports || typeof exports === 'string') return false;
  return Object.keys(exports).some((key) => key === `${prefix}*` || key.startsWith(prefix));
}

async function checkFixtures(component: string, dir: string, manifest?: UIComponentManifest) {
  const severity = publicationSeverity(manifest);
  const fixturesDir = join(dir, 'fixtures');
  if (!existsSync(fixturesDir)) {
    report(component, 'missing fixtures/ directory with basic and empty demo cases', severity);
    return;
  }
  const basicFixture = firstExisting(join(fixturesDir, 'basic.ts'), join(fixturesDir, 'basic.json'));
  const emptyFixture = firstExisting(join(fixturesDir, 'empty.ts'), join(fixturesDir, 'empty.json'));
  if (!basicFixture) report(component, 'missing fixtures/basic.ts or fixtures/basic.json', severity);
  if (!emptyFixture) report(component, 'missing fixtures/empty.ts or fixtures/empty.json', severity);

  const interactionEvents = manifest?.interactionEvents ?? [];
  const selectionLikeEvents = interactionEvents.filter((event) => /select|highlight|open-/.test(event));
  if (!selectionLikeEvents.length) return;

  const fixtureFiles = await listFiles(fixturesDir, /\.(ts|tsx|json)$/);
  const fixtureText = (await Promise.all(fixtureFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  if (!/\b(selection|selected|highlight|onSelect|select[A-Z-]|openRef|objectRef)\b/i.test(fixtureText)) {
    report(component, `interactive events (${selectionLikeEvents.join(', ')}) should have a selection/open-ref fixture`, severity);
  }
}

async function checkImports(component: string, dir: string) {
  const files = await listFiles(dir, /\.(ts|tsx)$/);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const specifier of importSpecifiers(text)) {
      if (isForbiddenAppImport(specifier)) {
        error(component, `${prettyPath(file)} imports app-private path "${specifier}"`);
      }
      const sibling = siblingComponentImport(component, file, specifier);
      if (sibling) {
        error(component, `${prettyPath(file)} imports sibling component "${sibling}" via "${specifier}"`);
      }
      if (isRelativeImportOutsidePackage(file, dir, specifier)) {
        error(component, `${prettyPath(file)} imports outside the component package via "${specifier}"`);
      }
    }
  }
}

function importSpecifiers(text: string) {
  const matches = text.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g);
  return [...matches].map((match) => match[1] ?? match[2] ?? match[3]).filter(Boolean);
}

function isForbiddenAppImport(specifier: string) {
  return specifier.startsWith('@/') ||
    specifier.startsWith('src/') ||
    specifier.startsWith('/src/') ||
    specifier.includes('/src/ui/') ||
    specifier.includes('/app/') ||
    specifier.includes('/workspace/') ||
    specifier.includes('src/ui/src') ||
    specifier.startsWith('@sciforge/app');
}

function siblingComponentImport(component: string, file: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined;
  const resolved = normalize(resolve(dirname(file), specifier));
  const relativeToUiRoot = relative(uiRoot, resolved).split(sep);
  const candidate = relativeToUiRoot[0];
  if (candidate && candidate !== component && componentNames.has(candidate)) return candidate;
  return undefined;
}

function isRelativeImportOutsidePackage(file: string, packageDir: string, specifier: string) {
  if (!specifier.startsWith('.')) return false;
  const resolved = normalize(resolve(dirname(file), specifier));
  const relativeToPackage = relative(packageDir, resolved);
  return relativeToPackage === '..' || relativeToPackage.startsWith(`..${sep}`);
}

function declaresDependency(packageJson: PackageJson | undefined, name: string) {
  return Boolean(packageJson?.dependencies?.[name] || packageJson?.peerDependencies?.[name]);
}

async function listFiles(root: string, pattern: RegExp): Promise<string[]> {
  if (!existsSync(root)) return [];
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path, pattern));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function firstExisting(...paths: string[]) {
  return paths.find((path) => existsSync(path));
}

function prettyPath(path: string) {
  return relative(repoRoot, path);
}

function error(component: string, message: string) {
  errors.push({ component, message });
}

function warn(component: string, message: string) {
  warnings.push({ component, message });
}

function report(component: string, message: string, severity: Severity) {
  if (severity === 'error') error(component, message);
  else warn(component, message);
}

function publicationSeverity(manifest?: UIComponentManifest): Severity {
  return manifest?.lifecycle === 'published' ? 'error' : 'warn';
}

function printResults() {
  if (warnings.length) {
    console.log(`UI component package boundary warnings (${warnings.length}):`);
    for (const finding of warnings) {
      console.log(`  - ${finding.component}: ${finding.message}`);
    }
    console.log('');
  }

  if (errors.length) {
    console.error(`UI component package boundary errors (${errors.length}):`);
    for (const finding of errors) {
      console.error(`  - ${finding.component}: ${finding.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    checked: componentDirNames.length,
    warnings: warnings.length,
  }, null, 2));
}
