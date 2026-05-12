import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

export const deepCoverageStages = [
  'protocol-pass',
  'mock-success',
  'minimal-smoke-data-success',
  'real-data-success',
  'trusted-scientific-conclusion',
] as const;

export const deepRunStatuses = ['passed', 'failed', 'repair-needed', 'not-run'] as const;

export type DeepCoverageStage = typeof deepCoverageStages[number];
export type DeepRunStatus = typeof deepRunStatuses[number];
export type DeepEvidenceRef = string | {
  id?: string;
  ref?: string;
  path?: string;
  kind?: string;
  label?: string;
  summary?: string;
  status?: string;
};
export type DeepVerificationVerdict = 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';

export interface DeepRunVerificationResult {
  id?: string;
  verdict: DeepVerificationVerdict;
  confidence?: number;
  reward?: number;
  critique?: string;
  evidenceRefs?: DeepEvidenceRef[];
  repairHints?: string[];
  diagnostics?: Record<string, unknown>;
  dataRef?: string;
}

export interface DeepRunManifest {
  schemaVersion: '1.0';
  scenarioId: string;
  title: string;
  taskId?: string;
  status: DeepRunStatus;
  coverageStage: DeepCoverageStage;
  run: {
    id: string;
    startedAt: string;
    completedAt?: string;
    operator?: string;
    entrypoint: 'browser-e2e' | 'manual-browser' | 'imported-artifacts' | 'framework-smoke';
  };
  prompt: {
    initial: string;
    compiledScenarioPrompt?: string;
    expectedOutcome?: string;
  };
  rounds: DeepRunRound[];
  runtimeProfile: {
    appUrl?: string;
    workspacePath?: string;
    agentBackend?: string;
    modelProvider?: string;
    modelName?: string;
    runtimeProfileId?: string;
    mockModel?: boolean;
    dataMode?: 'mock' | 'minimal-smoke' | 'real' | 'mixed' | 'unavailable';
  };
  artifacts: DeepRunArtifact[];
  executionUnits: DeepRunExecutionUnit[];
  failurePoints: DeepRunFailurePoint[];
  screenshots: DeepRunScreenshot[];
  sessionBundleRef?: string;
  runtimeEventsRef?: string;
  taskInputRefs?: DeepEvidenceRef[];
  taskOutputRefs?: DeepEvidenceRef[];
  stdoutRefs?: DeepEvidenceRef[];
  stderrRefs?: DeepEvidenceRef[];
  verificationResults?: DeepRunVerificationResult[];
  finalUserVisibleResultRef?: string;
  qualityScores: DeepRunQualityScores;
  notes?: string;
}

export interface DeepRunRound {
  round: number;
  userPrompt: string;
  expectedBehavior?: string;
  observedBehavior: string;
  status: DeepRunStatus;
  artifactRefs?: string[];
  executionUnitRefs?: string[];
  screenshotRefs?: string[];
}

export interface DeepRunArtifact {
  id: string;
  type: string;
  path?: string;
  producer?: string;
  round?: number;
  status?: 'produced' | 'missing' | 'invalid' | 'partial';
  summary?: string;
}

export interface DeepRunExecutionUnit {
  id: string;
  tool?: string;
  status: string;
  runtimeProfile?: string;
  attempt?: number;
  startedAt?: string;
  completedAt?: string;
  logRef?: string;
  artifactRefs?: string[];
  failureReason?: string;
}

export interface DeepRunFailurePoint {
  id: string;
  round?: number;
  severity: 'info' | 'warning' | 'error' | 'blocker';
  category: 'protocol' | 'model' | 'runtime' | 'data' | 'artifact-schema' | 'ui' | 'scientific-quality' | 'other';
  summary: string;
  evidenceRefs?: string[];
  repairAction?: string;
  resolved?: boolean;
}

export interface DeepRunScreenshot {
  id: string;
  path: string;
  round?: number;
  caption?: string;
}

export interface DeepRunQualityScores {
  taskCompletion: number;
  reproducibility: number;
  dataAuthenticity: number;
  artifactSchema: number;
  selfHealing: number;
  reportQuality: number;
  overall?: number;
  rationale?: string;
}

export interface LoadedDeepManifest {
  manifest: DeepRunManifest;
  path: string;
  directory: string;
  issues: string[];
}

export interface DeepReportResult {
  manifests: LoadedDeepManifest[];
  missingManifestDirectories: string[];
  markdownPath: string;
  htmlPath: string;
  hasValidationErrors: boolean;
}

export const deepRunEvidenceFieldKeys = [
  'sessionBundleRef',
  'runtimeEventsRef',
  'taskInputRefs',
  'taskOutputRefs',
  'stdoutRefs',
  'stderrRefs',
  'verificationResults',
  'finalUserVisibleResultRef',
] as const;

export type DeepRunEvidenceFieldKey = typeof deepRunEvidenceFieldKeys[number];

export interface DeepRunEvidenceSummary {
  present: DeepRunEvidenceFieldKey[];
  missing: DeepRunEvidenceFieldKey[];
  counts: Record<DeepRunEvidenceFieldKey, number>;
  totalRefs: number;
  verificationVerdicts: DeepVerificationVerdict[];
}

const scoreKeys: Array<keyof Omit<DeepRunQualityScores, 'overall' | 'rationale'>> = [
  'taskCompletion',
  'reproducibility',
  'dataAuthenticity',
  'artifactSchema',
  'selfHealing',
  'reportQuality',
];

export async function findDeepManifestPaths(rootDir = resolve('docs', 'test-artifacts', 'deep-scenarios')) {
  const manifests: string[] = [];
  await walk(rootDir);
  return manifests.sort((left, right) => left.localeCompare(right));

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === 'manifest.json') {
        manifests.push(fullPath);
      }
    }
  }
}

export async function loadDeepManifests(options: { rootDir?: string; scenario?: string } = {}) {
  const rootDir = options.rootDir ?? resolve('docs', 'test-artifacts', 'deep-scenarios');
  const paths = await findDeepManifestPaths(rootDir);
  const loaded: LoadedDeepManifest[] = [];
  for (const path of paths) {
    const text = await readFile(path, 'utf8');
    const raw = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
    const issues = validateDeepRunManifest(raw);
    const manifest = raw as DeepRunManifest;
    const directory = dirname(path);
    if (options.scenario && manifest.scenarioId !== options.scenario && basename(directory) !== options.scenario) {
      continue;
    }
    loaded.push({ manifest, path, directory, issues });
  }
  return loaded;
}

export function validateDeepRunManifest(value: unknown) {
  const issues: string[] = [];
  if (!isRecord(value)) return ['manifest must be a JSON object'];

  requireString(value, 'schemaVersion', issues);
  if (value.schemaVersion !== '1.0') issues.push('schemaVersion must be "1.0"');
  requireString(value, 'scenarioId', issues);
  requireString(value, 'title', issues);
  requireEnum(value, 'status', deepRunStatuses, issues);
  requireEnum(value, 'coverageStage', deepCoverageStages, issues);

  if (!isRecord(value.run)) {
    issues.push('run must be an object');
  } else {
    requireString(value.run, 'id', issues, 'run.');
    requireString(value.run, 'startedAt', issues, 'run.');
    requireEnum(value.run, 'entrypoint', ['browser-e2e', 'manual-browser', 'imported-artifacts', 'framework-smoke'], issues, 'run.');
  }

  if (!isRecord(value.prompt)) {
    issues.push('prompt must be an object');
  } else {
    requireString(value.prompt, 'initial', issues, 'prompt.');
  }

  requireArray(value, 'rounds', issues);
  if (Array.isArray(value.rounds)) {
    value.rounds.forEach((round, index) => validateRound(round, index, issues));
  }

  if (!isRecord(value.runtimeProfile)) issues.push('runtimeProfile must be an object');
  requireArray(value, 'artifacts', issues);
  requireArray(value, 'executionUnits', issues);
  requireArray(value, 'failurePoints', issues);
  requireArray(value, 'screenshots', issues);

  if (Array.isArray(value.artifacts)) value.artifacts.forEach((artifact, index) => validateArtifact(artifact, index, issues));
  if (Array.isArray(value.executionUnits)) value.executionUnits.forEach((unit, index) => validateExecutionUnit(unit, index, issues));
  if (Array.isArray(value.failurePoints)) value.failurePoints.forEach((failure, index) => validateFailurePoint(failure, index, issues));
  if (Array.isArray(value.screenshots)) value.screenshots.forEach((screenshot, index) => validateScreenshot(screenshot, index, issues));
  validateEvidenceFields(value, issues);

  if (!isRecord(value.qualityScores)) {
    issues.push('qualityScores must be an object');
  } else {
    for (const key of scoreKeys) requireScore(value.qualityScores, key, issues);
    if ('overall' in value.qualityScores) requireScore(value.qualityScores, 'overall', issues);
  }

  return issues;
}

export function summarizeDeepRunEvidence(manifest: DeepRunManifest): DeepRunEvidenceSummary {
  const counts: Record<DeepRunEvidenceFieldKey, number> = {
    sessionBundleRef: manifest.sessionBundleRef ? 1 : 0,
    runtimeEventsRef: manifest.runtimeEventsRef ? 1 : 0,
    taskInputRefs: manifest.taskInputRefs?.length ?? 0,
    taskOutputRefs: manifest.taskOutputRefs?.length ?? 0,
    stdoutRefs: manifest.stdoutRefs?.length ?? 0,
    stderrRefs: manifest.stderrRefs?.length ?? 0,
    verificationResults: manifest.verificationResults?.length ?? 0,
    finalUserVisibleResultRef: manifest.finalUserVisibleResultRef ? 1 : 0,
  };
  const present = deepRunEvidenceFieldKeys.filter((key) => counts[key] > 0);
  return {
    present,
    missing: deepRunEvidenceFieldKeys.filter((key) => counts[key] === 0),
    counts,
    totalRefs: deepRunEvidenceFieldKeys.reduce((sum, key) => sum + counts[key], 0),
    verificationVerdicts: (manifest.verificationResults ?? []).map((result) => result.verdict),
  };
}

export async function generateDeepTestReport(options: { rootDir?: string; scenario?: string; outDir?: string } = {}): Promise<DeepReportResult> {
  const rootDir = options.rootDir ?? resolve('docs', 'test-artifacts', 'deep-scenarios');
  const outDir = options.outDir ?? rootDir;
  const manifests = await loadDeepManifests({ rootDir, scenario: options.scenario });
  const missingManifestDirectories = await findScenarioDirectoriesMissingManifest(rootDir, manifests, options.scenario);
  const generatedAt = new Date().toISOString();
  const suffix = options.scenario ? `.${options.scenario}` : '';
  const markdownPath = join(outDir, `deep-test-report${suffix}.md`);
  const htmlPath = join(outDir, `index${suffix}.html`);

  await mkdir(outDir, { recursive: true });
  await writeFile(markdownPath, renderMarkdownReport(manifests, missingManifestDirectories, generatedAt, rootDir, options.scenario));
  await writeFile(htmlPath, renderHtmlIndex(manifests, missingManifestDirectories, generatedAt, rootDir, options.scenario));

  return {
    manifests,
    missingManifestDirectories,
    markdownPath,
    htmlPath,
    hasValidationErrors: manifests.some((entry) => entry.issues.length > 0),
  };
}

function validateRound(value: unknown, index: number, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`rounds[${index}] must be an object`);
    return;
  }
  if (typeof value.round !== 'number') issues.push(`rounds[${index}].round must be a number`);
  requireString(value, 'userPrompt', issues, `rounds[${index}].`);
  requireString(value, 'observedBehavior', issues, `rounds[${index}].`);
  requireEnum(value, 'status', deepRunStatuses, issues, `rounds[${index}].`);
}

function validateArtifact(value: unknown, index: number, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`artifacts[${index}] must be an object`);
    return;
  }
  requireString(value, 'id', issues, `artifacts[${index}].`);
  requireString(value, 'type', issues, `artifacts[${index}].`);
}

function validateExecutionUnit(value: unknown, index: number, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`executionUnits[${index}] must be an object`);
    return;
  }
  requireString(value, 'id', issues, `executionUnits[${index}].`);
  requireString(value, 'status', issues, `executionUnits[${index}].`);
}

function validateFailurePoint(value: unknown, index: number, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`failurePoints[${index}] must be an object`);
    return;
  }
  requireString(value, 'id', issues, `failurePoints[${index}].`);
  requireString(value, 'summary', issues, `failurePoints[${index}].`);
  requireEnum(value, 'severity', ['info', 'warning', 'error', 'blocker'], issues, `failurePoints[${index}].`);
  requireEnum(value, 'category', ['protocol', 'model', 'runtime', 'data', 'artifact-schema', 'ui', 'scientific-quality', 'other'], issues, `failurePoints[${index}].`);
}

function validateScreenshot(value: unknown, index: number, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`screenshots[${index}] must be an object`);
    return;
  }
  requireString(value, 'id', issues, `screenshots[${index}].`);
  requireString(value, 'path', issues, `screenshots[${index}].`);
}

function validateEvidenceFields(value: Record<string, unknown>, issues: string[]) {
  requireOptionalString(value, 'sessionBundleRef', issues);
  requireOptionalString(value, 'runtimeEventsRef', issues);
  requireOptionalString(value, 'finalUserVisibleResultRef', issues);
  validateOptionalEvidenceRefArray(value, 'taskInputRefs', issues);
  validateOptionalEvidenceRefArray(value, 'taskOutputRefs', issues);
  validateOptionalEvidenceRefArray(value, 'stdoutRefs', issues);
  validateOptionalEvidenceRefArray(value, 'stderrRefs', issues);
  if ('verificationResults' in value) {
    if (!Array.isArray(value.verificationResults)) {
      issues.push('verificationResults must be an array');
    } else {
      value.verificationResults.forEach((result, index) => validateVerificationResult(result, index, issues));
    }
  }
}

function validateVerificationResult(value: unknown, index: number, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`verificationResults[${index}] must be an object`);
    return;
  }
  requireEnum(value, 'verdict', ['pass', 'fail', 'uncertain', 'needs-human', 'unverified'], issues, `verificationResults[${index}].`);
  if ('confidence' in value && typeof value.confidence !== 'number') issues.push(`verificationResults[${index}].confidence must be a number`);
  if ('reward' in value && typeof value.reward !== 'number') issues.push(`verificationResults[${index}].reward must be a number`);
  if ('id' in value) requireOptionalString(value, 'id', issues, `verificationResults[${index}].`);
  if ('critique' in value) requireOptionalString(value, 'critique', issues, `verificationResults[${index}].`);
  if ('dataRef' in value) requireOptionalString(value, 'dataRef', issues, `verificationResults[${index}].`);
  validateOptionalEvidenceRefArray(value, 'evidenceRefs', issues, `verificationResults[${index}].`);
  validateOptionalStringArray(value, 'repairHints', issues, `verificationResults[${index}].`);
  if ('diagnostics' in value && !isRecord(value.diagnostics)) issues.push(`verificationResults[${index}].diagnostics must be an object`);
}

async function findScenarioDirectoriesMissingManifest(rootDir: string, manifests: LoadedDeepManifest[], scenario?: string) {
  const manifestDirs = new Set(manifests.map((entry) => entry.directory));
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const missing: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    if (scenario && entry.name !== scenario) continue;
    const directory = join(rootDir, entry.name);
    if (!manifestDirs.has(directory)) missing.push(directory);
  }
  return missing.sort((left, right) => left.localeCompare(right));
}

function renderMarkdownReport(entries: LoadedDeepManifest[], missingManifestDirectories: string[], generatedAt: string, rootDir: string, scenario?: string) {
  const lines = [
    '# SciForge Deep Test Report',
    '',
    `Generated: ${generatedAt}`,
    scenario ? `Scenario filter: \`${scenario}\`` : 'Scenario filter: all',
    '',
    '## Summary',
    '',
    `- Manifests: ${entries.length}`,
    `- Artifact directories missing manifest: ${missingManifestDirectories.length}`,
    `- Validation errors: ${entries.filter((entry) => entry.issues.length > 0).length}`,
    `- H022 evidence refs: ${entries.reduce((sum, entry) => sum + summarizeDeepRunEvidence(entry.manifest).totalRefs, 0)}`,
    ...deepCoverageStages.map((stage) => `- ${stage}: ${entries.filter((entry) => entry.manifest.coverageStage === stage).length}`),
    '',
    '## Scenario Matrix',
    '',
    '| Scenario | Status | Coverage | Overall | Rounds | Artifacts | ExecutionUnits | Failures | H022 Evidence | Manifest |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  if (entries.length === 0) {
    lines.push('| _No deep manifests found_ | not-run | - | - | 0 | 0 | 0 | 0 | 0 | - |');
  } else {
    for (const entry of entries) {
      const manifest = entry.manifest;
      const overall = getOverallScore(manifest.qualityScores).toFixed(1);
      const manifestRef = relative(rootDir, entry.path).replaceAll('\\', '/');
      lines.push(`| ${escapeMarkdown(manifest.scenarioId)} | ${manifest.status} | ${manifest.coverageStage} | ${overall} | ${manifest.rounds.length} | ${manifest.artifacts.length} | ${manifest.executionUnits.length} | ${manifest.failurePoints.length} | ${summarizeDeepRunEvidence(manifest).totalRefs} | [manifest](${manifestRef}) |`);
    }
  }

  if (missingManifestDirectories.length > 0) {
    lines.push('', '## Artifact Directories Missing Manifest', '');
    for (const directory of missingManifestDirectories) {
      lines.push(`- \`${relative(rootDir, directory).replaceAll('\\', '/')}/\``);
    }
  }

  const invalid = entries.filter((entry) => entry.issues.length > 0);
  if (invalid.length > 0) {
    lines.push('', '## Manifest Issues', '');
    for (const entry of invalid) {
      lines.push(`### ${entry.manifest.scenarioId ?? basename(entry.directory)}`, '');
      for (const issue of entry.issues) lines.push(`- ${issue}`);
      lines.push('');
    }
  }

  lines.push('', '## Quality Rubric', '');
  lines.push('- 0: missing or unverifiable');
  lines.push('- 1: protocol shell only');
  lines.push('- 2: mock path succeeds');
  lines.push('- 3: minimal smoke data succeeds with reproducible artifacts');
  lines.push('- 4: real data path succeeds with documented limitations');
  lines.push('- 5: real scientific conclusion is credible, traceable, and reproducible');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderHtmlIndex(entries: LoadedDeepManifest[], missingManifestDirectories: string[], generatedAt: string, rootDir: string, scenario?: string) {
  const cards = entries.map((entry) => {
    const manifest = entry.manifest;
    const relativeDir = relative(rootDir, entry.directory).replaceAll('\\', '/');
    const screenshot = manifest.screenshots[0]?.path;
    const screenshotPath = screenshot ? `${relativeDir}/${screenshot}`.replaceAll('\\', '/') : '';
    const issues = entry.issues.length > 0 ? `<p class="issues">${entry.issues.length} schema issue(s)</p>` : '';
    const evidence = summarizeDeepRunEvidence(manifest);
    const evidenceLabel = evidence.present.length ? evidence.present.join(', ') : 'none';
    return `
    <article class="card">
      ${screenshotPath ? `<a href="./${escapeHtml(screenshotPath)}"><img src="./${escapeHtml(screenshotPath)}" alt="${escapeHtml(manifest.scenarioId)} screenshot" loading="lazy" /></a>` : '<div class="empty">No screenshot</div>'}
      <div class="content">
        <h2>${escapeHtml(manifest.title)}</h2>
        <p><strong>${escapeHtml(manifest.scenarioId)}</strong> · ${escapeHtml(manifest.status)} · ${escapeHtml(manifest.coverageStage)}</p>
        <p>Overall ${getOverallScore(manifest.qualityScores).toFixed(1)} / 5 · ${manifest.rounds.length} rounds · ${manifest.artifacts.length} artifacts · ${manifest.executionUnits.length} EUs</p>
        <p>H022 evidence ${evidence.totalRefs} · ${escapeHtml(evidenceLabel)}</p>
        ${issues}
        <a href="./${escapeHtml(relativeDir)}/manifest.json">manifest.json</a>
      </div>
    </article>`;
  }).join('\n');
  const missingCards = missingManifestDirectories.map((directory) => {
    const scenarioId = relative(rootDir, directory).replaceAll('\\', '/');
    return `
    <article class="card">
      <div class="empty">Manifest needed</div>
      <div class="content">
        <h2>${escapeHtml(scenarioId)}</h2>
        <p>Artifact directory exists, but manifest.json has not been written yet.</p>
      </div>
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SciForge Deep Test Artifacts</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #070b12; color: #dbe7f5; }
    body { margin: 0; padding: 28px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 24px; }
    p { margin: 6px 0 0; color: #8ea4bf; }
    a { color: #7fc7ff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    .card { border: 1px solid rgba(111, 132, 160, 0.28); border-radius: 8px; overflow: hidden; background: #101826; }
    .card img, .empty { display: block; width: 100%; height: 220px; object-fit: cover; object-position: top left; background: #050812; }
    .empty { display: grid; place-items: center; color: #8ea4bf; }
    .content { display: grid; gap: 6px; padding: 14px; }
    h2 { margin: 0; font-size: 16px; }
    .issues { color: #ffca7a; }
    time { color: #8ea4bf; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>SciForge Deep Test Artifacts</h1>
      <p>${scenario ? `Filtered scenario: ${escapeHtml(scenario)}` : 'Deep scenario manifests, screenshots, quality scores, and failure records.'}</p>
      <p><a href="./deep-test-report.md">Markdown summary report</a></p>
    </div>
    <time datetime="${generatedAt}">${generatedAt}</time>
  </header>
  <main class="grid">
${cards}
${missingCards}
${cards || missingCards ? '' : '    <p>No deep manifests found. Add scenario manifest.json files under docs/test-artifacts/deep-scenarios/.</p>'}
  </main>
</body>
</html>
`;
}

function getOverallScore(scores: DeepRunQualityScores) {
  if (typeof scores.overall === 'number') return scores.overall;
  return scoreKeys.reduce((sum, key) => sum + scores[key], 0) / scoreKeys.length;
}

async function walkFiles(rootDir: string) {
  const files: string[] = [];
  await walk(rootDir);
  return files;

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile()) files.push(fullPath);
    }
  }
}

export async function pathExists(path: string) {
  return stat(path).then(() => true, () => false);
}

export async function listDeepFiles(rootDir: string) {
  return walkFiles(rootDir);
}

function requireArray(value: Record<string, unknown>, key: string, issues: string[]) {
  if (!Array.isArray(value[key])) issues.push(`${key} must be an array`);
}

function requireString(value: Record<string, unknown>, key: string, issues: string[], prefix = '') {
  if (typeof value[key] !== 'string' || value[key].trim() === '') issues.push(`${prefix}${key} must be a non-empty string`);
}

function requireOptionalString(value: Record<string, unknown>, key: string, issues: string[], prefix = '') {
  if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].trim() === '')) {
    issues.push(`${prefix}${key} must be a non-empty string`);
  }
}

function validateOptionalStringArray(value: Record<string, unknown>, key: string, issues: string[], prefix = '') {
  if (!(key in value)) return;
  if (!Array.isArray(value[key])) {
    issues.push(`${prefix}${key} must be an array`);
    return;
  }
  value[key].forEach((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') issues.push(`${prefix}${key}[${index}] must be a non-empty string`);
  });
}

function validateOptionalEvidenceRefArray(value: Record<string, unknown>, key: string, issues: string[], prefix = '') {
  if (!(key in value)) return;
  if (!Array.isArray(value[key])) {
    issues.push(`${prefix}${key} must be an array`);
    return;
  }
  value[key].forEach((item, index) => validateEvidenceRef(item, `${prefix}${key}[${index}]`, issues));
}

function validateEvidenceRef(value: unknown, path: string, issues: string[]) {
  if (typeof value === 'string') {
    if (value.trim() === '') issues.push(`${path} must be a non-empty string or ref object`);
    return;
  }
  if (!isRecord(value)) {
    issues.push(`${path} must be a non-empty string or ref object`);
    return;
  }
  const hasRefIdentity = ['id', 'ref', 'path'].some((key) => typeof value[key] === 'string' && value[key].trim() !== '');
  if (!hasRefIdentity) issues.push(`${path} must include id, ref, or path`);
  for (const key of ['id', 'ref', 'path', 'kind', 'label', 'summary', 'status']) {
    if (key in value) requireOptionalString(value, key, issues, `${path}.`);
  }
}

function requireEnum<T extends string>(value: Record<string, unknown>, key: string, options: readonly T[], issues: string[], prefix = '') {
  if (typeof value[key] !== 'string' || !options.includes(value[key] as T)) {
    issues.push(`${prefix}${key} must be one of ${options.join(', ')}`);
  }
}

function requireScore(value: Record<string, unknown>, key: string, issues: string[]) {
  const score = value[key];
  if (typeof score !== 'number' || score < 0 || score > 5) {
    issues.push(`qualityScores.${key} must be a number from 0 to 5`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeMarkdown(value: string) {
  return value.replaceAll('|', '\\|');
}
