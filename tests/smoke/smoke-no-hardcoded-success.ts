import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

type Finding = {
  file: string;
  line: number;
  rule: string;
  text: string;
};

type Rule = {
  id: string;
  pattern: RegExp;
  description: string;
};

const root = process.cwd();
const scannedRoots = ['src', 'packages'];
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage', '__pycache__']);
const scannedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.json', '.md']);

const allowedPathPatterns = [
  /^tests\//,
  /(^|\/)fixtures?\//,
  /^docs(?:\/|$)/,
  /^docs_old(?:\/|$)/,
  /(^|\/)test-artifacts\//,
  /^packages\/scenarios\/core\/src\/scenarioDemoData\.ts$/,
  /\.test\.[cm]?[tj]sx?$/,
  /\.fixture\.[cm]?[tj]sx?$/,
];

const rules: Rule[] = [
  {
    id: 'runtime-acceptance-passphrase',
    description: 'Release/runtime paths must not contain browser/live acceptance passphrases.',
    pattern: /\b(?:SCIFORGE-IAB|SCIFORGE-CODEX-BROWSER|SCIFORGE_REAL_RESUME|DIRECT-SKIP|DIRECT-SKIP-GIT-OK)\b/,
  },
  {
    id: 'sample-science-conclusion',
    description: 'Sample scientific conclusions belong only in demo/test/artifact paths.',
    pattern: /\b(?:KRAS\s+G12C|EGFR\/MET|KRAS\s+Y96D|Y96D|7BZ5|sotorasib|adagrasib)\b|47\s*篇/,
  },
  {
    id: 'prompt-specific-success-copy',
    description: 'Prompt-specific success wording must not be hardcoded in product/runtime defaults.',
    pattern: /(?:reply only remembered|只回复\s*remembered|Now reply only with the passphrase|visible second-turn answer|acceptanceConclusionFromRealBrowser\s*[:=]\s*true)/i,
  },
  {
    id: 'sample-success-marker',
    description: 'Release/runtime paths must not bake generic fake-success or browser-acceptance pass markers into defaults.',
    pattern: /\b(?:sample-success|sampleSuccess|sample_success|fakeSuccess|hardcodedSuccess|mockSuccess|expectedSuccess|acceptancePassed|browserAcceptancePassed|liveAcceptancePassed)\b/i,
  },
];

assertRuleFixtures();

const findings: Finding[] = [];

for (const scanRoot of scannedRoots) {
  for (const file of await collectFiles(join(root, scanRoot))) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (isAllowedPath(rel)) continue;
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isCommentOnlyLine(line)) return;
      for (const rule of rules) {
        if (!rule.pattern.test(line)) continue;
        findings.push({
          file: rel,
          line: index + 1,
          rule: rule.id,
          text: line.trim(),
        });
      }
    });
  }
}

if (findings.length) {
  console.error('[no-hardcoded-success] forbidden hardcoded success/demo literals found in release paths');
  for (const finding of findings) {
    const rule = rules.find((item) => item.id === finding.rule);
    console.error(`- ${finding.file}:${finding.line} [${finding.rule}] ${rule?.description ?? ''}`);
    console.error(`  ${finding.text}`);
  }
  process.exitCode = 1;
} else {
  assert.equal(findings.length, 0);
  console.log('[ok] no-hardcoded-success gate found no release-path acceptance passphrases, sample science conclusions, prompt-specific success copy, or generic fake-success markers');
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...await collectFiles(join(dir, entry.name)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!scannedExtensions.has(extname(entry.name))) continue;
    files.push(join(dir, entry.name));
  }
  return files;
}

function isAllowedPath(file: string): boolean {
  return allowedPathPatterns.some((pattern) => pattern.test(file));
}

function isCommentOnlyLine(line: string): boolean {
  return /^\s*(?:\/\/|#|\*|\*)/.test(line);
}

function assertRuleFixtures() {
  const fixtureCases = [
    {
      rule: 'sample-success-marker',
      text: 'const browserAcceptancePassed = true;',
    },
    {
      rule: 'sample-success-marker',
      text: "const fixture = 'sample-success';",
    },
    {
      rule: 'prompt-specific-success-copy',
      text: "const copy = 'Now reply only with the passphrase';",
    },
    {
      rule: 'runtime-acceptance-passphrase',
      text: "const marker = 'SCIFORGE-CODEX-BROWSER';",
    },
  ];

  for (const fixture of fixtureCases) {
    const rule = rules.find((item) => item.id === fixture.rule);
    assert.ok(rule, `missing smoke rule fixture target: ${fixture.rule}`);
    assert.match(fixture.text, rule.pattern, `fixture must be caught by ${fixture.rule}`);
  }
}
