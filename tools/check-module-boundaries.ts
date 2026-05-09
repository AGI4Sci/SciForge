import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

type ImportEdge = {
  importer: string;
  specifier: string;
  line: number;
  resolvedPath?: string;
};

type Finding = ImportEdge & {
  message: string;
  rule: string;
};

type WarningRule = {
  id: string;
  description: string;
  match: (edge: ImportEdge) => boolean;
};

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage']);

const knownPackagePrivateImportWarnings: WarningRule[] = [
  {
    id: 'legacy-object-reference-ui-domain-types',
    description: 'packages/object-references still imports UI domain types; migrate those contracts into packages/runtime-contract or a package-owned contract file.',
    match: (edge) => edge.importer.startsWith('packages/object-references/') && pointsAtUiDomain(edge),
  },
  {
    id: 'legacy-artifact-preview-ui-domain-types',
    description: 'packages/artifact-preview still imports UI domain types; migrate preview/artifact contracts into packages/runtime-contract or a package-owned contract file.',
    match: (edge) => edge.importer.startsWith('packages/artifact-preview/') && pointsAtUiDomain(edge),
  },
];

const knownUiPackageDeepImportWarnings: WarningRule[] = [
  {
    id: 'ui-scenario-core-bridge-src-reexports',
    description: 'src/ui/src/scenarioCompiler is a compatibility bridge over packages/scenario-core/src; migrate callers to package public exports.',
    match: (edge) => edge.importer.startsWith('src/ui/src/scenarioCompiler/') && edge.resolvedPath?.startsWith('packages/scenario-core/src/') === true,
  },
  {
    id: 'ui-component-workbench-fixtures',
    description: 'componentWorkbenchDemo imports renderer fixtures directly; keep this limited to workbench/demo data or switch to package export aliases.',
    match: (edge) => edge.importer === 'src/ui/src/componentWorkbenchDemo.ts' && /^packages\/ui-components\/[^/]+\/fixtures\//.test(edge.resolvedPath ?? ''),
  },
  {
    id: 'ui-component-workbench-types',
    description: 'componentWorkbenchDemo imports ui-components/types through a relative package path; prefer @sciforge-ui/components/types when aliases are available.',
    match: (edge) => edge.importer === 'src/ui/src/componentWorkbenchDemo.ts' && edge.resolvedPath === 'packages/ui-components/types',
  },
  {
    id: 'ui-scenario-specs-src-import',
    description: 'src/ui/src/scenarioSpecs imports packages/scenario-core/src/scenarioSpecs; migrate to package public exports with the rest of the scenario bridge.',
    match: (edge) => edge.importer === 'src/ui/src/scenarioSpecs.ts' && edge.resolvedPath === 'packages/scenario-core/src/scenarioSpecs',
  },
  {
    id: 'ui-design-system-src-bridge',
    description: 'src/ui/src/app/uiPrimitives imports packages/design-system/src; use @agi4sci/design-system or the package root export after aliases are settled.',
    match: (edge) => edge.importer === 'src/ui/src/app/uiPrimitives.tsx' && edge.resolvedPath === 'packages/design-system/src',
  },
  {
    id: 'ui-workbench-renderer-entry',
    description: 'ComponentWorkbenchPage imports a component renderer subpath directly; prefer the package export alias when available.',
    match: (edge) => edge.importer === 'src/ui/src/app/ComponentWorkbenchPage.tsx' && /^packages\/ui-components\/[^/]+\/render$/.test(edge.resolvedPath ?? ''),
  },
];

async function main() {
  const packageRoots = await collectPackageRoots();
  const packageNames = await collectPackageNames(packageRoots);
  const files = [
    ...await collectSourceFiles(join(root, 'packages')),
    ...await collectSourceFiles(join(root, 'src/ui/src')),
  ];
  const edges = (await Promise.all(files.map(readImportEdges))).flat();

  const errors: Finding[] = [];
  const warnings: Finding[] = [];

  for (const edge of edges) {
    if (edge.importer.startsWith('packages/')) {
      checkPackagePrivateRuntimeImport(edge, errors, warnings);
    }
    if (edge.importer.startsWith('src/ui/src/')) {
      checkUiPackageDeepImport(edge, packageRoots, packageNames, errors, warnings);
    }
  }

  if (warnings.length) {
    console.warn('[module-boundaries] warnings: known migration exceptions remain');
    for (const [rule, grouped] of groupFindings(warnings)) {
      console.warn(`- ${rule}: ${grouped[0].message} (${grouped.length})`);
      for (const finding of grouped.slice(0, 8)) {
        console.warn(`  ${finding.importer}:${finding.line} -> ${finding.specifier}`);
      }
      if (grouped.length > 8) console.warn(`  ... ${grouped.length - 8} more`);
    }
  }

  if (errors.length) {
    console.error('[module-boundaries] boundary violations found');
    for (const finding of errors) {
      console.error(`- ${finding.importer}:${finding.line} -> ${finding.specifier}`);
      console.error(`  ${finding.message}`);
    }
    console.error('Move shared contracts into packages/runtime-contract, packages/scenario-core, or a package public export; update the allowlist only for intentional temporary migrations.');
    process.exitCode = 1;
    return;
  }

  console.log(`[ok] module boundaries checked: ${files.length} files, ${edges.length} imports.`);
}

function checkPackagePrivateRuntimeImport(edge: ImportEdge, errors: Finding[], warnings: Finding[]) {
  if (!pointsAtPrivateAppOrRuntime(edge)) return;
  const allowed = knownPackagePrivateImportWarnings.find((rule) => rule.match(edge));
  const finding = {
    ...edge,
    rule: allowed?.id ?? 'package-private-app-runtime-import',
    message: allowed?.description ?? 'Package code must not import src/ui/src or src/runtime private files.',
  };
  if (allowed) warnings.push(finding);
  else errors.push(finding);
}

function checkUiPackageDeepImport(
  edge: ImportEdge,
  packageRoots: string[],
  packageNames: Map<string, string>,
  errors: Finding[],
  warnings: Finding[],
) {
  if (edge.resolvedPath?.startsWith('packages/')) {
    const packageRoot = longestPackageRootForPath(edge.resolvedPath, packageRoots);
    if (!packageRoot) return;
    const subpath = packageSubpath(edge.resolvedPath, packageRoot);
    if (!subpath || subpath === 'index' || subpath === 'index.ts' || subpath === 'index.tsx') return;
    const allowed = knownUiPackageDeepImportWarnings.find((rule) => rule.match(edge));
    const finding = {
      ...edge,
      rule: allowed?.id ?? 'ui-package-relative-deep-import',
      message: allowed?.description ?? `UI app imports package internals (${packageRoot}/${subpath}); use the package root or an exported subpath instead.`,
    };
    if (allowed) warnings.push(finding);
    else errors.push(finding);
    return;
  }

  const barePackage = bareWorkspacePackage(edge.specifier, packageNames);
  if (!barePackage) return;
  const subpath = edge.specifier.slice(barePackage.name.length).replace(/^\//, '');
  if (!subpath) return;
  if (subpath.includes('/src/') || subpath === 'src' || subpath.startsWith('src/')) {
    errors.push({
      ...edge,
      rule: 'ui-package-bare-src-import',
      message: `UI app imports ${barePackage.root}/${subpath}; use ${barePackage.name} public exports instead of package src internals.`,
    });
  }
}

async function collectPackageRoots() {
  const packageJsonFiles = await collectFiles(join(root, 'packages'), (name) => name === 'package.json');
  return packageJsonFiles
    .map((file) => relative(root, dirname(file)).replaceAll('\\', '/'))
    .sort((left, right) => right.length - left.length);
}

async function collectPackageNames(packageRoots: string[]) {
  const names = new Map<string, string>();
  for (const packageRoot of packageRoots) {
    const json = JSON.parse(await readFile(join(root, packageRoot, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof json.name === 'string') names.set(json.name, packageRoot);
  }
  return names;
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  return collectFiles(dir, (name) => sourceExtensions.has(extension(name)));
}

async function collectFiles(dir: string, includeFile: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectFiles(full, includeFile));
      continue;
    }
    if (entry.isFile() && includeFile(entry.name)) out.push(full);
  }
  return out;
}

async function readImportEdges(file: string): Promise<ImportEdge[]> {
  const text = await readFile(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const importer = relative(root, file).replaceAll('\\', '/');
  const edges: ImportEdge[] = [];

  function add(specifier: string, node: ts.Node) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    edges.push({
      importer,
      specifier,
      line,
      resolvedPath: resolveSpecifier(importer, specifier),
    });
  }

  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node.moduleSpecifier);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [firstArg] = node.arguments;
      if (firstArg && ts.isStringLiteral(firstArg)) add(firstArg.text, firstArg);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return edges;
}

function resolveSpecifier(importer: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined;
  return relative(root, resolve(root, dirname(importer), specifier)).replaceAll('\\', '/');
}

function pointsAtPrivateAppOrRuntime(edge: ImportEdge) {
  return edge.resolvedPath?.startsWith('src/ui/src/') === true
    || edge.resolvedPath === 'src/ui/src'
    || edge.resolvedPath?.startsWith('src/runtime/') === true
    || edge.resolvedPath === 'src/runtime'
    || /(^|\/)src\/ui\/src(\/|$)/.test(edge.specifier)
    || /(^|\/)src\/runtime(\/|$)/.test(edge.specifier);
}

function pointsAtUiDomain(edge: ImportEdge) {
  return edge.resolvedPath === 'src/ui/src/domain' || edge.resolvedPath === 'src/ui/src/domain.ts';
}

function longestPackageRootForPath(path: string, packageRoots: string[]) {
  return packageRoots.find((packageRoot) => path === packageRoot || path.startsWith(`${packageRoot}/`));
}

function packageSubpath(path: string, packageRoot: string) {
  return path === packageRoot ? '' : path.slice(packageRoot.length + 1);
}

function bareWorkspacePackage(specifier: string, packageNames: Map<string, string>) {
  for (const [name, packageRoot] of packageNames) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return { name, root: packageRoot };
  }
  return undefined;
}

function groupFindings(findings: Finding[]) {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    groups.set(finding.rule, [...(groups.get(finding.rule) ?? []), finding]);
  }
  return groups.entries();
}

function extension(name: string) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
}

await main();
