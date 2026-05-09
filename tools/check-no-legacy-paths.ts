import { access, readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';

type Finding = {
  file: string;
  line: number;
  rule: string;
  message: string;
  text: string;
  migration?: string;
};

type Rule = {
  id: string;
  message: string;
  appliesTo: (file: string) => boolean;
  match: (line: string, file: string) => boolean;
};

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage', '__pycache__']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

const rules: Rule[] = [
  {
    id: 'ui-semantic-fallback',
    message: 'UI code owns semantic fallback routing that should come from manifests, view policy, or package-owned compatibility aliases.',
    appliesTo: (file) => file.startsWith('src/ui/src/'),
    match: (line) => isCodeLine(line)
      && /\bfallback\b/i.test(line)
      && /\b(artifact|component|module|view|renderer|scenario|domain|provider|producer|consumer|schema|slot|unknown-artifact|generic-(?:data-table|artifact-inspector))\b/i.test(line)
      && !/<Suspense\s+fallback=/.test(line),
  },
  {
    id: 'provider-scenario-prompt-special-case',
    message: 'Runtime/UI code carries provider, scenario, or prompt special-case branching that should be manifest/catalog driven.',
    appliesTo: isLegacyPolicySurface,
    match: (line, file) => isCodeLine(line)
      && !/^export\s+/.test(line.trim())
      && !isPackageManifestFallbackLine(line)
      && /\b(provider|scenario|prompt)\b/i.test(`${basename(file)} ${line}`)
      && /(?:^\s*(?:if|else if|switch|case)\b|\?\s|\.includes\(|\.startsWith\(|\.endsWith\(|\.match\(|\.test\(|new RegExp|\/[^/\n]+\/[a-z]*|===|!==)/.test(line)
      && /(?:[`'"][a-z0-9][a-z0-9._:/-]*(?:[._:/-][a-z0-9][a-z0-9._:/-]*)+[`'"]|\/[^/\n]+\/[a-z]*|\b(?:provider|scenario|prompt)\s*(?:[.[]|===|!==))/.test(line),
  },
  {
    id: 'legacy-adapter-compat-reexport',
    message: 'Legacy adapter/compat modules are re-exported instead of being cut over to stable package/runtime entrypoints.',
    appliesTo: (file) => file.startsWith('src/') || file.startsWith('packages/'),
    match: (line, file) => isCodeLine(line)
      && /^export\s+(?:\*|\{|\w)/.test(line.trim())
      && /\bfrom\b/.test(line)
      && /\b(adapter|compat|compatibility|legacy)\b/i.test(`${file} ${line}`),
  },
  {
    id: 'legacy-package-facade-reexport',
    message: 'UI legacy facade re-exports package-owned scenario APIs instead of importing stable package entrypoints directly.',
    appliesTo: (file) => file.startsWith('src/ui/src/'),
    match: (line, file) => isCodeLine(line)
      && /^export\s+(?:\*|\{|\w)/.test(line.trim())
      && /\bfrom\s+['"]@sciforge\/scenario-core\//.test(line)
      && (/^src\/ui\/src\/scenarioCompiler\//.test(file) || file === 'src/ui/src/scenarioSpecs.ts'),
  },
];

// Current T120 final-cutover baseline. This guard is deliberately conservative:
// it freezes known legacy/fallback paths and fails only when a file/rule count
// increases or a new untracked file/rule appears. When a migration removes one
// of these paths, lower the matching count in this table in the same change.
const trackedBaselineCounts: Record<string, number> = {
  'src/runtime/gateway/agent-backend-config.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/agentserver-context-window.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/agentserver-prompts.ts#provider-scenario-prompt-special-case': 2,
  'src/runtime/gateway/backend-failure-diagnostics.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/context-envelope.ts#provider-scenario-prompt-special-case': 1,
  'src/runtime/gateway/gateway-request.ts#provider-scenario-prompt-special-case': 1,
  'src/runtime/gateway/capability-evolution-events.ts#provider-scenario-prompt-special-case': 1,
  'src/runtime/gateway/repair-policy.ts#provider-scenario-prompt-special-case': 2,
  'src/runtime/gateway/work-evidence-guard.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/workspace-event-normalizer.ts#provider-scenario-prompt-special-case': 3,
  'src/ui/src/app/ComponentWorkbenchPage.tsx#ui-semantic-fallback': 3,
  'src/ui/src/app/ScenarioBuilderPanel.tsx#ui-semantic-fallback': 6,
  'src/ui/src/app/results/WorkspaceObjectPreview.tsx#ui-semantic-fallback': 1,
  'src/ui/src/app/uiPrimitives.tsx#ui-semantic-fallback': 1,
  'src/ui/src/runtimeContracts.ts#ui-semantic-fallback': 1,
};

const migrationByFile: Array<{ file: RegExp; migration: string }> = [
  { file: /^src\/ui\/src\/app\/results\/viewPlanResolver\.ts$/, migration: 'T120/T119: move result fallback ranking into manifest/view policy and reduce this legacy baseline.' },
  { file: /^src\/ui\/src\/uiModuleRegistry\.ts$/, migration: 'T120/T119: retire UI compatibility alias fallback once package manifests own all legacy ids.' },
  { file: /^src\/ui\/src\/app\/ScenarioBuilderPanel\.tsx$/, migration: 'T120/T119: move scenario fallback component policy into scenario packages and registry contracts.' },
  { file: /^src\/ui\/src\/app\/ComponentWorkbenchPage\.tsx$/, migration: 'T120/T119: keep workbench fallback display informational; remove semantic fallback selection from UI.' },
  { file: /^src\/ui\/src\/app\/chat\/runOrchestrator\.ts$/, migration: 'T120/T119: remove prompt/scenario special cases from chat orchestration and use package/runtime policy.' },
  { file: /^src\/runtime\/gateway\/agentserver-prompts\.ts$/, migration: 'T120/T122: move provider/prompt special cases from prompt text into capability manifests or runtime policy.' },
  { file: /^src\/runtime\/gateway\//, migration: 'T120/T122: gateway may keep transport/runtime fallback, but provider/scenario/prompt branches must migrate to policy/catalogs.' },
  { file: /^src\/runtime\/skill-registry\//, migration: 'T120/T122: move prompt/provider skill matching special cases into package skill manifests and catalog metadata.' },
  { file: /^src\/runtime\/skill-markdown-catalog\.ts$/, migration: 'T120/T122: move skill provider normalization into skill package metadata/catalog generation.' },
  { file: /^src\/runtime\/runtime-ui-manifest\.ts$/, migration: 'T120/T122: move prompt-driven UI composition defaults into package-owned view policy.' },
  { file: /^src\/ui\/src\//, migration: 'T120/T119: remove UI semantic fallback and facade re-export paths after package-owned view/scenario policy cutover.' },
  { file: /^packages\/presentation\/components\//, migration: 'T120/T080: keep legacy component aliases frozen until stable primitive renderer cutover is complete.' },
  { file: /^packages\/scenarios\//, migration: 'T120/T122: scenario package compatibility defaults are frozen while package runtime profiles cut over.' },
  { file: /^packages\//, migration: 'T120: package legacy adapter/compat paths are frozen; add stable package entrypoints instead.' },
  { file: /^src\/ui\/src\/scenarioCompiler\//, migration: 'T120/T119: remove UI package facade re-exports once callers import @sciforge/scenario-core directly.' },
  { file: /^src\/ui\/src\/scenarioSpecs\.ts$/, migration: 'T120/T119: remove UI scenario spec facade once callers import @sciforge/scenario-core directly.' },
];

async function main() {
  const files = [
    ...await collectSourceFilesIfExists(join(root, 'src')),
    ...await collectSourceFilesIfExists(join(root, 'packages')),
  ];
  const findings: Finding[] = [];

  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of rules) {
        if (!rule.appliesTo(rel) || !rule.match(line, rel)) continue;
        findings.push({
          file: rel,
          line: index + 1,
          rule: rule.id,
          message: rule.message,
          text: line.trim(),
          migration: trackedMigration(rel, rule.id),
        });
      }
    });
  }

  const counts = countByFileRule(findings);
  const overflowKeys = new Set([...counts.entries()]
    .filter(([key, count]) => count > (trackedBaselineCounts[key] ?? 0))
    .map(([key]) => key));
  const errors = findings.filter((finding) => overflowKeys.has(findingKey(finding)));
  const warnings = findings.filter((finding) => !overflowKeys.has(findingKey(finding)) && finding.migration);
  const shrinkableKeys = Object.entries(trackedBaselineCounts)
    .filter(([key, baseline]) => (counts.get(key) ?? 0) < baseline);

  if (warnings.length) {
    console.warn('[no-legacy-paths] warnings: tracked T120 legacy paths remain');
    printGrouped(warnings, false, 'warn');
  }

  if (shrinkableKeys.length) {
    console.warn('[no-legacy-paths] baseline can be reduced after migrations:');
    for (const [key, baseline] of shrinkableKeys) {
      console.warn(`- ${key}: baseline ${baseline}, current ${counts.get(key) ?? 0}`);
    }
  }

  if (errors.length) {
    console.error('[no-legacy-paths] untracked or increased legacy paths found');
    for (const [key, grouped] of groupBy(errors, findingKey)) {
      console.error(`- ${key}: ${grouped[0].message} (${grouped.length}; baseline ${trackedBaselineCounts[key] ?? 0}, current ${counts.get(key) ?? 0})`);
      for (const finding of grouped) console.error(`  ${finding.file}:${finding.line} ${finding.text}`);
    }
    console.error('Do not add new UI semantic fallback, provider/scenario/prompt special cases, or legacy adapter/compat re-exports. Move the behavior into manifests, catalogs, package-owned policy, or stable runtime entrypoints; only update this baseline with an explicit T120 migration note.');
    process.exitCode = 1;
    return;
  }

  console.log(`[ok] no increased legacy paths found: ${files.length} source files, ${warnings.length} tracked findings.`);
}

function trackedMigration(file: string, rule: string) {
  const key = `${file}#${rule}`;
  if (trackedBaselineCounts[key] === undefined) return undefined;
  return migrationByFile.find((entry) => entry.file.test(file))?.migration
    ?? 'T120 tracked baseline: existing legacy path must be migrated before this baseline is reduced.';
}

function countByFileRule(findings: Finding[]) {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(findingKey(finding), (counts.get(findingKey(finding)) ?? 0) + 1);
  return counts;
}

function findingKey(finding: Pick<Finding, 'file' | 'rule'>) {
  return `${finding.file}#${finding.rule}`;
}

function printGrouped(findings: Finding[], includeEveryFinding: boolean, level: 'warn' | 'error') {
  const printer = level === 'warn' ? console.warn : console.error;
  for (const grouped of groupBy(findings, (finding) => `${finding.rule}:${finding.migration ?? 'untracked'}`).values()) {
    const first = grouped[0];
    printer(`- ${first.rule}: ${first.message} (${grouped.length})`);
    if (first.migration) printer(`  ${first.migration}`);
    for (const finding of grouped.slice(0, includeEveryFinding ? grouped.length : 8)) {
      printer(`  ${finding.file}:${finding.line} ${finding.text}`);
    }
    if (!includeEveryFinding && grouped.length > 8) printer(`  ... ${grouped.length - 8} more`);
  }
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyFor(item), [...(groups.get(keyFor(item)) ?? []), item]);
  return groups;
}

function isCodeLine(line: string) {
  const trimmed = line.trim();
  return trimmed.length > 0
    && !trimmed.startsWith('import ')
    && !trimmed.startsWith('//')
    && !trimmed.startsWith('*');
}

function isPackageManifestFallbackLine(line: string) {
  return /\bfallbackModuleIds\s*:/.test(line) || /\bfallbackAcceptable\s*:/.test(line);
}

function isLegacyPolicySurface(file: string) {
  return /^src\/runtime\/gateway\//.test(file)
    || /^src\/runtime\/skill-registry\//.test(file)
    || file === 'src/runtime/runtime-ui-manifest.ts'
    || file === 'src/runtime/skill-markdown-catalog.ts'
    || file === 'src/ui/src/app/chat/runOrchestrator.ts'
    || file === 'src/ui/src/app/results/viewPlanResolver.ts';
}

async function collectSourceFilesIfExists(dir: string): Promise<string[]> {
  try {
    await access(dir);
  } catch {
    return [];
  }
  return collectFiles(dir);
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectFiles(full));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name)) && !isTestFile(full)) out.push(full);
  }
  return out.sort();
}

function isTestFile(file: string) {
  const rel = relative(root, file).replaceAll('\\', '/');
  return /(^|\/)(tests?|__tests__|fixtures)\//.test(rel) || /\.(test|spec)\.[^.]+$/.test(rel);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
