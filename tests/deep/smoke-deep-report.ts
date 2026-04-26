import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDeepTestReport, validateDeepRunManifest, type DeepRunManifest } from '../../tools/deep-test-manifest';

const tempRoot = join(tmpdir(), `bioagent-deep-report-${Date.now()}`);
const deepRoot = join(tempRoot, 'deep-scenarios');
const rootDir = join(deepRoot, 'demo-scenario');
await mkdir(rootDir, { recursive: true });
const manifestPath = join(rootDir, 'manifest.json');

const manifest: DeepRunManifest = {
  schemaVersion: '1.0',
  scenarioId: 'demo-scenario',
  title: 'Demo Deep Scenario',
  taskId: 'T060',
  status: 'passed',
  coverageStage: 'minimal-smoke-data-success',
  run: {
    id: 'deep-demo-2026-04-26',
    startedAt: '2026-04-26T00:00:00.000Z',
    completedAt: '2026-04-26T00:01:00.000Z',
    entrypoint: 'framework-smoke',
  },
  prompt: {
    initial: 'Create a demo scenario for deep manifest validation.',
    expectedOutcome: 'A manifest that exercises every required report field.',
  },
  rounds: [
    {
      round: 1,
      userPrompt: 'Plan and run the demo.',
      observedBehavior: 'The framework fixture produced a report artifact and execution unit.',
      status: 'passed',
      artifactRefs: ['report-demo'],
      executionUnitRefs: ['EU-demo'],
      screenshotRefs: ['home'],
    },
  ],
  runtimeProfile: {
    appUrl: 'http://localhost:5173/',
    runtimeProfileId: 'framework-smoke',
    mockModel: true,
    dataMode: 'minimal-smoke',
  },
  artifacts: [
    {
      id: 'report-demo',
      type: 'research-report',
      path: 'reports/demo.md',
      status: 'produced',
      round: 1,
      producer: 'framework-smoke',
    },
  ],
  executionUnits: [
    {
      id: 'EU-demo',
      tool: 'framework-smoke',
      status: 'done',
      runtimeProfile: 'framework-smoke',
      attempt: 1,
      artifactRefs: ['report-demo'],
    },
  ],
  failurePoints: [
    {
      id: 'FP-demo-limitation',
      severity: 'info',
      category: 'scientific-quality',
      summary: 'Framework smoke validates reporting only; it is not a real T054-T059 scientific run.',
      resolved: true,
    },
  ],
  screenshots: [
    {
      id: 'home',
      path: 'screenshots/home.png',
      round: 1,
      caption: 'Framework smoke placeholder screenshot ref.',
    },
  ],
  qualityScores: {
    taskCompletion: 3,
    reproducibility: 5,
    dataAuthenticity: 2,
    artifactSchema: 5,
    selfHealing: 3,
    reportQuality: 4,
    rationale: 'The fixture is intentionally limited to report automation coverage.',
  },
};

await mkdir(join(rootDir, 'reports'), { recursive: true });
await mkdir(join(rootDir, 'screenshots'), { recursive: true });
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await writeFile(join(rootDir, 'reports', 'demo.md'), '# Demo\n');
await writeFile(join(rootDir, 'screenshots', 'home.png'), '');

assert.deepEqual(validateDeepRunManifest(manifest), []);

const allReport = await generateDeepTestReport({ rootDir: deepRoot });
assert.equal(allReport.hasValidationErrors, false);
assert.equal(allReport.manifests.length, 1);

const markdown = await readFile(allReport.markdownPath, 'utf8');
assert.match(markdown, /demo-scenario/);
assert.match(markdown, /minimal-smoke-data-success/);
assert.match(markdown, /Quality Rubric/);

const filtered = await generateDeepTestReport({ rootDir: deepRoot, scenario: 'missing-scenario' });
assert.equal(filtered.manifests.length, 0);

const html = await readFile(allReport.htmlPath, 'utf8');
assert.match(html, /BioAgent Deep Test Artifacts/);
assert.match(html, /manifest\.json/);

console.log('[ok] deep manifest validation and report generation smoke passed');
