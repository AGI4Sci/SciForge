import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

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
  pattern: RegExp;
};

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage', '__pycache__']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.py']);

const packageRuntimeOwnershipRules: Rule[] = [
  {
    id: 'package-artifact-persistence-lifecycle',
    message: 'Package code appears to own artifact persistence or artifact index lifecycle.',
    pattern: /\b(artifact_index|build_artifact_index|artifact index|artifact persistence|artifact store|\.sciforge\/artifacts)\b/i,
  },
  {
    id: 'package-workspace-ref-resolution',
    message: 'Package code appears to resolve workspace refs or build bounded handoff refs.',
    pattern: /\b(reference_digest|build_reference_digests?|ref resolution|reference resolution|agentserver:\/\/|handoff refs?|handoff budget|bounded handoff)\b/i,
  },
  {
    id: 'package-stream-lifecycle',
    message: 'Package code appears to own stream/process event lifecycle.',
    pattern: /\b(process_events|streaming-draft|background completion|stream lifecycle|event normalization|process event)\b/i,
  },
  {
    id: 'package-global-safety-lifecycle',
    message: 'Package code appears to own global safety, turn, session, or conversation lifecycle.',
    pattern: /\b(global safety|turn lifecycle|session lifecycle|conversation service|capability broker|execution classifier|latency policy|cache policy|response plan|acceptance policy|recovery policy)\b/i,
  },
];

const trackedPackageBaselineCounts: Record<string, number> = {
  'packages/reasoning/conversation-policy/src/sciforge_conversation/recovery.py#package-workspace-ref-resolution': 1,
  'packages/reasoning/conversation-policy/src/sciforge_conversation/service.py#package-workspace-ref-resolution': 2,
};

async function main() {
  const findings: Finding[] = [];

  for (const file of await collectSourceFilesIfExists(join(root, 'src/shared'))) {
    findings.push({
      file: relative(root, file).replaceAll('\\', '/'),
      line: 1,
      rule: 'legacy-src-shared-file',
      message: 'src/shared is not a fixed platform boundary; contracts belong in packages/contracts/runtime, runtime execution in src/runtime, and UI in src/ui.',
      text: 'src/shared',
    });
  }

  const packageFiles = await collectSourceFilesIfExists(join(root, 'packages'));
  for (const file of packageFiles) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of packageRuntimeOwnershipRules) {
        if (!rule.pattern.test(line)) continue;
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
    .filter(([key, count]) => count > (trackedPackageBaselineCounts[key] ?? 0))
    .map(([key]) => key));
  const errors = findings.filter((finding) => overflowKeys.has(findingKey(finding)));
  const warnings = findings.filter((finding) => !overflowKeys.has(findingKey(finding)) && finding.migration);

  if (warnings.length) {
    console.warn('[fixed-platform-boundary] warnings: tracked T122 package -> src migrations remain');
    printGrouped(warnings, false);
  }

  if (errors.length) {
    console.error('[fixed-platform-boundary] fixed platform boundary violations found');
    printGrouped(errors, true);
    console.error('Packages may own pluggable capability semantics, manifests, schemas, validators, providers, examples, and repair hints. Runtime lifecycle ownership stays in src/.');
    process.exitCode = 1;
    return;
  }

  console.log(`[ok] fixed platform boundary checked: ${packageFiles.length} package source files, ${warnings.length} tracked warnings.`);
}

function trackedMigration(file: string, rule: string) {
  if (trackedPackageBaselineCounts[`${file}#${rule}`] === undefined) return undefined;
  if (file.includes('/conversation-policy/')) {
    return 'T122 packages -> src: migrate conversation-policy runtime lifecycle, refs, artifact index, and stream ownership into src/runtime.';
  }
  return 'T122 tracked package baseline: existing package runtime ownership terms must migrate to src before this baseline is reduced.';
}

function countByFileRule(findings: Finding[]) {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(findingKey(finding), (counts.get(findingKey(finding)) ?? 0) + 1);
  return counts;
}

function findingKey(finding: Pick<Finding, 'file' | 'rule'>) {
  return `${finding.file}#${finding.rule}`;
}

function printGrouped(findings: Finding[], includeEveryFinding: boolean) {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = `${finding.rule}:${finding.migration ?? 'untracked'}`;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }

  for (const grouped of groups.values()) {
    const first = grouped[0];
    console.warn(`- ${first.rule}: ${first.message} (${grouped.length})`);
    if (first.migration) console.warn(`  ${first.migration}`);
    for (const finding of grouped.slice(0, includeEveryFinding ? grouped.length : 8)) {
      console.warn(`  ${finding.file}:${finding.line} ${finding.text}`);
    }
    if (!includeEveryFinding && grouped.length > 8) console.warn(`  ... ${grouped.length - 8} more`);
  }
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
  return /(^|\/)(tests?|__tests__)\//.test(rel) || /\.(test|spec)\.[^.]+$/.test(rel);
}

await main();
