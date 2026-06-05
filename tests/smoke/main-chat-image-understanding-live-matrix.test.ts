import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';

import {
  mainChatImageUnderstandingLiveMatrixCases,
  requiredMainChatImageUnderstandingCategories,
} from '../../tools/main-chat-image-understanding-live-matrix-cases.js';
import {
  buildMainChatImageUnderstandingLiveMatrixManifest,
  validateMainChatImageUnderstandingLiveMatrixMaterials,
} from '../../tools/main-chat-image-understanding-live-matrix.js';
import type {
  MainChatImageUnderstandingLiveMatrixCase,
} from '../../tools/main-chat-image-understanding-live-matrix-cases.js';

const broadForbiddenRawPayloadPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|api[_-]?key|secret|token|credential|password|https?:\/\/|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)/i;

test('main chat image understanding live matrix defines the required diverse categories refs-first', () => {
  const categories = new Set(mainChatImageUnderstandingLiveMatrixCases.map((item) => item.category));
  assert.deepEqual([...categories].sort(), [...requiredMainChatImageUnderstandingCategories].sort());

  const ids = new Set<string>();
  const refs = new Set<string>();
  for (const item of mainChatImageUnderstandingLiveMatrixCases) {
    const rubric = (item as {
      answerRubric?: {
        minAnswerTextLength?: number;
        requiredConcepts?: Array<{ id?: string; anyOf?: string[] }>;
      };
    }).answerRubric;
    assert.equal(ids.has(item.id), false, `duplicate case id: ${item.id}`);
    assert.equal(refs.has(item.material.ref), false, `duplicate material ref: ${item.material.ref}`);
    ids.add(item.id);
    refs.add(item.material.ref);
    assert.match(item.material.ref, /^docs\/test-artifacts\/main-chat-image-understanding-live-matrix\/materials\/[a-z0-9-]+\.(?:png|jpg|jpeg|webp)$/);
    assert.match(item.material.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.ok(item.material.width > 0);
    assert.ok(item.material.height > 0);
    assert.ok(item.prompts.length >= 1);
    assert.match(item.prompts.join(' '), /quote|exact visible text/i, `${item.id} prompt must request exact visible text`);
    assert.ok(rubric, `${item.id} must define an answer rubric`);
    assert.ok((rubric?.minAnswerTextLength ?? 0) >= 48, `${item.id} must require a substantive answer`);
    assert.ok((rubric?.requiredConcepts?.length ?? 0) >= 2, `${item.id} must require multiple visible concepts`);
    for (const concept of rubric?.requiredConcepts ?? []) {
      assert.match(concept.id ?? '', /^[a-z0-9-]+$/);
      assert.ok((concept.anyOf?.length ?? 0) >= 1, `${item.id}:${concept.id} must have acceptable terms`);
    }
    assert.equal(Object.hasOwn(item, 'expectedAnswer'), false, `${item.id} must not encode fake answer text`);
    assert.doesNotMatch(JSON.stringify(item), broadForbiddenRawPayloadPattern);
  }
});

test('main chat image understanding live matrix fixed materials exist and match registry hashes', async () => {
  for (const item of mainChatImageUnderstandingLiveMatrixCases) {
    const bytes = await readFile(item.material.ref);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${item.id} must be a PNG fixture`);
    assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, item.material.sha256);
  }
});

test('main chat image understanding live matrix material validator fail-closes bad release fixtures without leaking paths', async () => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true });
  const workspace = await mkdtemp(join(process.cwd(), '.tmp', 'main-chat-image-material-validator-'));
  const notPngPath = join(workspace, 'not-a-png.bin');
  const hashMismatchPath = join(workspace, 'hash-mismatch.png');
  const tinyPng = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1,
    8, 6, 0, 0, 0, 31, 21, 196, 137,
  ]);
  await writeFile(notPngPath, 'plain text fixture', 'utf8');
  await writeFile(hashMismatchPath, tinyPng);

  const cases: MainChatImageUnderstandingLiveMatrixCase[] = [
    syntheticMaterialCase('missing-material', join(workspace, 'missing.png'), syntheticSha256('0')),
    syntheticMaterialCase('not-png-material', notPngPath, syntheticSha256('1')),
    syntheticMaterialCase('hash-mismatch-material', hashMismatchPath, syntheticSha256('2')),
  ];

  try {
    const issues = await validateMainChatImageUnderstandingLiveMatrixMaterials(cases);
    assert.ok(issues.includes('material-missing:missing-material'), issues.join('\n'));
    assert.ok(issues.includes('material-not-png:not-png-material'), issues.join('\n'));
    assert.ok(issues.includes('material-sha256-mismatch:hash-mismatch-material'), issues.join('\n'));
    assert.doesNotMatch(JSON.stringify(issues), broadForbiddenRawPayloadPattern);
    assert.equal(JSON.stringify(issues).includes(workspace), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function syntheticMaterialCase(
  id: string,
  ref: string,
  sha256: `sha256:${string}`,
): MainChatImageUnderstandingLiveMatrixCase {
  return {
    id,
    category: 'scientific-chart',
    title: id,
    material: {
      ref,
      sha256,
      width: 1,
      height: 1,
      sourceKind: 'fixed-release-material',
      licenseNote: 'Synthetic material validator fixture.',
    },
    prompts: ['Inspect the image.'],
    evidenceRequirements: ['answer-text-digest'],
    answerRubric: {
      minAnswerTextLength: 48,
      requiredConcepts: [
        { id: 'synthetic-concept-a', anyOf: ['inspect'] },
        { id: 'synthetic-concept-b', anyOf: ['image'] },
      ],
    },
  };
}

function syntheticSha256(char: string): `sha256:${string}` {
  return `sha256:${char.repeat(64)}`;
}

function mainChatTraceAuditFor(options: { materialBindingIssues?: string[]; materialBindingSource?: 'trace-root-scan' } = {}) {
  return {
    status: 'pass' as const,
    schemaVersion: 'sciforge.model-router.trace-audit.v1',
    traceRootSha256: '0'.repeat(64),
    reportRef: 'docs/test-artifacts/main-chat-image-understanding-live-matrix/trace-audit.json',
    scannedFiles: mainChatImageUnderstandingLiveMatrixCases.length,
    scannedBytes: mainChatImageUnderstandingLiveMatrixCases.length * 128,
    scannedFileRefs: mainChatImageUnderstandingLiveMatrixCases.map((_, index) => `2026-06-05/resp_${index + 1}/trace.json`),
    findings: [],
    policy: {
      knownSecretsChecked: 2,
      forbidsRawProviderPayload: true,
      forbidsRawPrivateUrls: true,
      forbidsLocalAbsolutePaths: true,
      forbidsInlineImageData: true,
    },
    ...options,
  };
}

test('main chat image understanding live matrix manifest cannot pass without every live case and trace audit', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: [{
      caseId: mainChatImageUnderstandingLiveMatrixCases[0].id,
      status: 'passed',
      answerText: 'The chart shows a higher treated response.',
      traceRef: '.sciforge/model-router-traces/2026-06-05/resp_one',
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    }],
    traceAudit: {
      status: 'pass',
      reportRef: 'docs/test-artifacts/main-chat-image-understanding-live-matrix/trace-audit.json',
      scannedFiles: mainChatImageUnderstandingLiveMatrixCases.length,
      scannedFileRefs: mainChatImageUnderstandingLiveMatrixCases.map((_, index) => `2026-06-05/resp_${index + 1}/trace.json`),
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseAcceptance, 'opt-in-only');
  assert.ok(manifest.issues.some((issue) => issue.includes('missing-case')));
  assert.ok(manifest.issues.some((issue) => issue.includes('missing-category')));
  assert.equal(Object.hasOwn(manifest.cases[0] ?? {}, 'answerText'), false);
  assert.match(String(manifest.cases[0]?.answerTextSha256), /^sha256:[a-f0-9]{64}$/);
  assert.equal(manifest.cases[0]?.answerTextLength, 'The chart shows a higher treated response.'.length);
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix manifest sanitizes raw result issues before publishing', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: passingAnswerForCase(item.id),
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
      issues: index === 0
        ? [
            'router leaked https://provider.example.test/v1/responses Authorization Bearer sk-test-secret',
            'trace contained /Users/alice/.sciforge/private/rawProviderPayload.json',
          ]
        : [],
    })),
    traceAudit: mainChatTraceAuditFor({ materialBindingIssues: [], materialBindingSource: 'trace-root-scan' }),
  });

  const manifestJson = JSON.stringify(manifest);
  assert.equal(manifest.status, 'blocked');
  assert.match(manifestJson, /issue:[a-f0-9]{16}/);
  assert.ok(manifest.cases[0]?.issues.every((issue) => !broadForbiddenRawPayloadPattern.test(issue)));
  assert.doesNotMatch(manifestJson, broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix blocks scheme-wrapped local absolute refs', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: [{
      caseId: mainChatImageUnderstandingLiveMatrixCases[0].id,
      status: 'passed',
      answerText: 'bounded answer',
      traceRef: 'artifact:/Users/alice/private/trace.json',
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    }],
    traceAudit: {
      status: 'pass',
      reportRef: 'trace-audit-report:/tmp/raw-report.json',
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.some((issue) => issue.includes('forbidden-raw-payload')));
  assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-report-ref-forbidden')));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix manifest passes only with full refs-first live evidence', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: passingAnswerForCase(item.id),
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit: mainChatTraceAuditFor({ materialBindingIssues: [], materialBindingSource: 'trace-root-scan' }),
  });

  assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
  assert.deepEqual(manifest.issues, []);
  assert.equal(manifest.coverage.everyRequiredCategoryPresent, true);
  assert.equal(manifest.coverage.allCasesPassed, true);
  assert.equal(manifest.traceAudit?.status, 'pass');
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix blocks visual non-inspection answers', () => {
  const refusalCaseId = 'microscopy-experimental-contrast';
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: item.id === refusalCaseId
        ? 'The image could not be inspected, but the answer mentions control and treated sample regions, annotations, bright puncta, contrast difference, and shift anyway.'
        : passingAnswerForCase(item.id),
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit: mainChatTraceAuditFor({ materialBindingIssues: [], materialBindingSource: 'trace-root-scan' }),
  });

  const refusalCase = manifest.cases.find((item) => item.id === refusalCaseId);
  assert.equal(manifest.status, 'blocked');
  assert.ok(refusalCase?.issues.includes('answer-visual-access-refusal'), refusalCase?.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix manifest rejects forged material binding arrays without trace-root proof', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: passingAnswerForCase(item.id),
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit: mainChatTraceAuditFor({ materialBindingIssues: [] }),
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-material-binding-proof-missing'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix manifest blocks placeholder case answers even with full refs-first trace evidence', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: `answer for case ${index + 1}`,
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit: mainChatTraceAuditFor({ materialBindingIssues: [], materialBindingSource: 'trace-root-scan' }),
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.some((issue) => issue.includes('answer-rubric')), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), /answer for case/i);
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix manifest blocks trace audits without material binding checks', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: `bounded answer ${index + 1}`,
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit: mainChatTraceAuditFor(),
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-material-binding-missing'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix manifest requires exact trace json audit coverage', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: `bounded answer ${index + 1}`,
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}/trace.json`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit: {
      ...mainChatTraceAuditFor({ materialBindingIssues: [] }),
      scannedFileRefs: mainChatImageUnderstandingLiveMatrixCases.map((_, index) => `2026-06-05/resp_${index + 1}/final-routing-summary.json`),
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-missing-trace:scientific-chart-legend-axis'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix rejects embedded traversal trace refs', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: `bounded answer ${index + 1}`,
      traceRef: index === 0
        ? '.sciforge/model-router-traces/2026-06-05/resp_1/../../resp_1/trace.json'
        : `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit: {
      ...mainChatTraceAuditFor({ materialBindingIssues: [] }),
      scannedFileRefs: mainChatImageUnderstandingLiveMatrixCases.map((_, index) => (
        index === 0
          ? '2026-06-05/resp_1/../../resp_1/trace.json'
          : `2026-06-05/resp_${index + 1}/trace.json`
      )),
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-missing-trace:scientific-chart-legend-axis'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix manifest blocks incomplete trace audit report metadata', () => {
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: `bounded answer ${index + 1}`,
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit: {
      status: 'pass',
      reportRef: 'docs/test-artifacts/main-chat-image-understanding-live-matrix/trace-audit.json',
      scannedFiles: mainChatImageUnderstandingLiveMatrixCases.length,
      scannedFileRefs: mainChatImageUnderstandingLiveMatrixCases.map((_, index) => `2026-06-05/resp_${index + 1}/trace.json`),
      materialBindingIssues: [],
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-fail'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix blocks trace audits without known secret scans', () => {
  const traceAudit = mainChatTraceAuditFor({ materialBindingIssues: [] });
  traceAudit.policy.knownSecretsChecked = 0;
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: `bounded answer ${index + 1}`,
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit,
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-fail'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix enforces expected known secret scan count', () => {
  const traceAudit = mainChatTraceAuditFor({ materialBindingIssues: [] });
  traceAudit.policy.knownSecretsChecked = 1;
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    requiredKnownSecretsChecked: 2,
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: `bounded answer ${index + 1}`,
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit,
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-known-corpus-checked-too-low'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix blocks inconsistent trace audit scan counts', () => {
  const traceAudit = mainChatTraceAuditFor({ materialBindingIssues: [] });
  traceAudit.scannedFiles = mainChatImageUnderstandingLiveMatrixCases.length + 10;
  const manifest = buildMainChatImageUnderstandingLiveMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
      caseId: item.id,
      status: 'passed' as const,
      answerText: `bounded answer ${index + 1}`,
      traceRef: `.sciforge/model-router-traces/2026-06-05/resp_${index + 1}`,
      publicModelAlias: 'sciforge-router',
      routerProfile: 'sciforge-runtime-default',
    })),
    traceAudit,
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-fail'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
});

test('main chat image understanding live matrix opt-in CLI blocks fake router evidence without trace audit binding', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-test-'));
  const traceAuditReport = join(workspaceTmp, 'trace-audit-report.json');
  await writeFile(traceAuditReport, JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace-audit.v1',
    status: 'pass',
    traceRootSha256: 'sha256:test-trace-root',
    scannedFiles: 4,
    scannedBytes: 1024,
    findings: [],
    policy: {
      knownSecretsChecked: 2,
      forbidsRawProviderPayload: true,
      forbidsRawPrivateUrls: true,
      forbidsLocalAbsolutePaths: true,
      forbidsInlineImageData: true,
    },
  }), 'utf8');

  const server = await startFakeModelRouterServer();
  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
      SCIFORGE_MODEL_ROUTER_TRACE_AUDIT_REPORT: traceAuditReport,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.traceAudit?.status, 'fail');
    assert.ok(manifest.traceAudit?.reportRef);
    assert.equal(manifest.coverage.allCasesPassed, true);
    assert.equal(manifest.coverage.everyRequiredCategoryPresent, true);
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
    assert.equal(JSON.stringify(manifest).includes('answer for case'), false);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI can bind post-run trace audit to current traces', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-post-run-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 0, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
    assert.equal(manifest.traceAudit?.status, 'pass');
    assert.equal(manifest.traceAudit?.scannedFiles, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
    assert.equal(JSON.stringify(manifest).includes(workspaceTmp), false);
    assert.equal(JSON.stringify(manifest).includes('answer for case'), false);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI binds custom trace-root-prefixed refs', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-custom-root-'));
  const traceRoot = join(workspaceTmp, 'custom-model-router-traces');
  const traceRootRef = relative(process.cwd(), traceRoot).replace(/\\/g, '/');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `${traceRootRef}/2026-06-05/resp_${requestIndex}`,
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 0, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
    assert.equal(manifest.traceAudit?.status, 'pass');
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
    assert.equal(JSON.stringify(manifest).includes(workspaceTmp), false);
    assert.equal(JSON.stringify(manifest).includes('answer for case'), false);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI rejects reused aggregate trace bundles across cases', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-aggregate-trace-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const aggregateModalityRefs = mainChatImageUnderstandingLiveMatrixCases.map((item, index) => ({
    id: `image_${index + 1}`,
    kind: 'vision.image',
    source: 'ref',
    ref: item.material.ref,
    sha256: traceRefSha256(item.material.ref),
  }));
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: () => '.sciforge/model-router-traces/2026-06-05/resp_1',
    modalityRefsForRequest: () => aggregateModalityRefs,
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-duplicate-trace-ref')), manifest.issues.join('\n'));
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-material-scope')), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI rejects response and trace router identity mismatches', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-identity-mismatch-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
    responseModelForRequest: () => 'rogue-router',
    traceProfileForRequest: () => 'rogue-profile',
    tracePublicModelAliasForRequest: () => 'rogue-router',
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.some((issue) => issue.includes('router-public-model-alias-mismatch')), manifest.issues.join('\n'));
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-router-profile-mismatch')), manifest.issues.join('\n'));
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-router-public-model-alias-mismatch')), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI requires router public endpoints', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-public-contract-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    publicEndpoints: false,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.includes('router-public-contract-fail'), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI accepts provider-list Model Router public manifest', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-provider-manifest-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
    publicManifest: {
      protocolVersion: 'sciforge.tools.v1',
      workerId: 'sciforge.model-router',
      capabilities: ['model_router_responses', 'text_reasoning', 'vision_translation', 'refs_first_trace'],
      providers: [{
        providerId: 'sciforge.model-router.responses',
        capabilityId: 'model_router_responses',
        transport: 'http',
        invokePath: '/v1/responses',
        status: 'available',
      }, {
        providerId: 'sciforge.model-router.vision-translator',
        capabilityId: 'vision_translation',
        transport: 'http',
        invokePath: '/v1/responses',
        status: 'available',
      }],
    },
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 0, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI rejects answers that miss the case rubric', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-weak-answer-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
    answerTextForRequest: () => 'generic image answer without visible evidence',
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.some((issue) => issue.includes('answer-rubric')), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
    assert.equal(JSON.stringify(manifest).includes('generic image answer'), false);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI rejects stale pre-existing traces', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-stale-trace-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
    traceMtimeMsForRequest: () => Date.now() - 60_000,
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-stale-trace')), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
    assert.equal(JSON.stringify(manifest).includes(workspaceTmp), false);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI accepts traceRef paths ending in trace.json', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-trace-json-ref-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}/trace.json`,
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 0, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI blocks degraded router responses', async () => {
  for (const variant of ['metadata', 'body'] as const) {
    const tmpRoot = join(process.cwd(), '.tmp');
    await mkdir(tmpRoot, { recursive: true });
    const workspaceTmp = await mkdtemp(join(tmpRoot, `main-chat-image-understanding-live-matrix-${variant}-degraded-`));
    const traceRoot = join(workspaceTmp, 'model-router-traces');
    const server = await startFakeModelRouterServer({
      traceRoot,
      traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
      responseMetadataDegradedForRequest: () => variant === 'metadata',
      responseBodyDegradedForRequest: () => variant === 'body',
    });

    try {
      const { code, stdout, stderr } = await runNodeCli([
        '--import',
        'tsx',
        'tools/main-chat-image-understanding-live-matrix.ts',
        '--trace-root',
        traceRoot,
        '--json',
        '--strict',
      ], {
        SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
        SCIFORGE_MODEL_ROUTER_URL: server.url,
      });
      assert.equal(code, 1, `${variant}: ${stderr || stdout}`);
      const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
      assert.equal(manifest.status, 'blocked', variant);
      assert.ok(manifest.issues.some((issue) => issue.includes('router-degraded')), `${variant}: ${manifest.issues.join('\n')}`);
      assert.equal(manifest.traceAudit?.status, 'pass', variant);
      assert.equal(manifest.coverage.allCasesPassed, false, variant);
      assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
      assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
    } finally {
      await server.close();
      await rm(workspaceTmp, { recursive: true, force: true });
    }
  }
});

test('main chat image understanding live matrix opt-in CLI requires ref material binding to be hash-consistent', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-ref-hash-mismatch-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
    materialForRequest: (requestIndex) => ({
      ref: 'docs/test-artifacts/main-chat-image-understanding-live-matrix/materials/wrong-material.png',
      sha256: mainChatImageUnderstandingLiveMatrixCases[requestIndex - 1]?.material.sha256 ?? syntheticSha256('c'),
    }),
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-material-mismatch')), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
    assert.equal(JSON.stringify(manifest).includes('wrong-material.png'), false);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI blocks traces that do not bind to case materials', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-wrong-material-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
    materialForRequest: () => ({
      ref: 'docs/test-artifacts/main-chat-image-understanding-live-matrix/materials/wrong-material.png',
      sha256: syntheticSha256('a'),
    }),
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-material-mismatch')), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
    assert.equal(JSON.stringify(manifest).includes(workspaceTmp), false);
    assert.equal(JSON.stringify(manifest).includes('wrong-material.png'), false);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI requires structured modality material binding', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-unstructured-material-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
    materialForRequest: () => ({
      ref: 'docs/test-artifacts/main-chat-image-understanding-live-matrix/materials/wrong-material.png',
      sha256: syntheticSha256('b'),
    }),
    diagnosticTextForRequest: (requestIndex) => (
      `diagnostic mention only: ${mainChatImageUnderstandingLiveMatrixCases[requestIndex - 1]?.material.ref}`
    ),
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-material-mismatch')), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
    assert.equal(JSON.stringify(manifest).includes('wrong-material.png'), false);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI rejects inline modality hash spoof for ref-input cases', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-inline-spoof-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
    modalityRefsForRequest: (requestIndex) => [{
      id: `image_${requestIndex}`,
      kind: 'vision.image',
      source: 'inline',
      sha256: mainChatImageUnderstandingLiveMatrixCases[requestIndex - 1]?.material.sha256,
    }],
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-material-mismatch')), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test('main chat image understanding live matrix opt-in CLI requires vision translator trace role evidence', async () => {
  const tmpRoot = join(process.cwd(), '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const workspaceTmp = await mkdtemp(join(tmpRoot, 'main-chat-image-understanding-live-matrix-missing-vision-role-'));
  const traceRoot = join(workspaceTmp, 'model-router-traces');
  const server = await startFakeModelRouterServer({
    traceRoot,
    traceRefForRequest: (requestIndex) => `.sciforge/model-router-traces/2026-06-05/resp_${requestIndex}`,
    traceCallsForRequest: () => [{
      role: 'textReasoner',
      phase: 'text-control-or-final',
      status: 'ok',
      roleAlias: 'textReasoner',
      providerBindingSha256: 'sha256:text',
      wireApi: 'chat.completions',
    }],
  });

  try {
    const { code, stdout, stderr } = await runNodeCli([
      '--import',
      'tsx',
      'tools/main-chat-image-understanding-live-matrix.ts',
      '--trace-root',
      traceRoot,
      '--json',
      '--strict',
    ], {
      SCIFORGE_REQUIRE_MAIN_CHAT_IMAGE_MATRIX: '1',
      SCIFORGE_MODEL_ROUTER_URL: server.url,
    });
    assert.equal(code, 1, stderr || stdout);
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildMainChatImageUnderstandingLiveMatrixManifest>;
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.issues.some((issue) => issue.includes('trace-audit-required-role-missing')), manifest.issues.join('\n'));
    assert.equal(server.requests, mainChatImageUnderstandingLiveMatrixCases.length);
    assert.doesNotMatch(JSON.stringify(manifest), broadForbiddenRawPayloadPattern);
  } finally {
    await server.close();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

async function startFakeModelRouterServer(options: {
  traceRoot?: string;
  traceRefForRequest?: (requestIndex: number) => string;
  materialForRequest?: (requestIndex: number) => { ref: string; sha256: `sha256:${string}` };
  diagnosticTextForRequest?: (requestIndex: number) => string;
  traceMtimeMsForRequest?: (requestIndex: number) => number;
  traceCallsForRequest?: (requestIndex: number) => unknown[];
  modalityRefsForRequest?: (requestIndex: number) => unknown[];
  answerTextForRequest?: (requestIndex: number) => string;
  responseModelForRequest?: (requestIndex: number) => string;
  responseMetadataDegradedForRequest?: (requestIndex: number) => boolean;
  responseBodyDegradedForRequest?: (requestIndex: number) => boolean;
  traceProfileForRequest?: (requestIndex: number) => string;
  tracePublicModelAliasForRequest?: (requestIndex: number) => string;
  publicEndpoints?: boolean;
  publicManifest?: unknown;
} = {}) {
  let requests = 0;
  const server = createServer((request, response) => {
    if (options.publicEndpoints !== false && request.method === 'GET' && request.url === '/manifest') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(options.publicManifest ?? {
        schemaVersion: 'sciforge.model-router.manifest.v1',
        invokePath: '/v1/responses',
        capabilities: ['vision_translation', 'refs_first_trace'],
        defaultPublicModelAlias: 'sciforge-router',
      }));
      return;
    }
    if (options.publicEndpoints !== false && request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        object: 'list',
        data: [{
          id: 'sciforge-router',
          object: 'model',
        }],
      }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404).end();
      return;
    }
    requests += 1;
    const traceRef = options.traceRefForRequest?.(requests) ?? `.sciforge/model-router-traces/2026-06-05/resp_${requests}.json`;
    if (options.traceRoot) {
      writeTraceFixture(
        options.traceRoot,
        requests,
        options.materialForRequest?.(requests),
        options.diagnosticTextForRequest?.(requests),
        options.traceMtimeMsForRequest?.(requests),
        options.traceCallsForRequest?.(requests),
        options.modalityRefsForRequest?.(requests),
        options.traceProfileForRequest?.(requests),
        options.tracePublicModelAliasForRequest?.(requests),
      );
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      model: options.responseModelForRequest?.(requests) ?? 'sciforge-router',
      output_text: options.answerTextForRequest?.(requests)
        ?? passingAnswerForCase(mainChatImageUnderstandingLiveMatrixCases[requests - 1]?.id),
      degraded: options.responseBodyDegradedForRequest?.(requests) === true || undefined,
      metadata: {
        traceRef,
        degraded: options.responseMetadataDegradedForRequest?.(requests) === true || undefined,
      },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    get requests() {
      return requests;
    },
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function writeTraceFixture(
  traceRoot: string,
  requestIndex: number,
  material = {
    ref: mainChatImageUnderstandingLiveMatrixCases[requestIndex - 1]?.material.ref,
    sha256: traceRefSha256(mainChatImageUnderstandingLiveMatrixCases[requestIndex - 1]?.material.ref ?? ''),
  },
  diagnosticText?: string,
  traceMtimeMs?: number,
  calls?: unknown[],
  modalityRefs?: unknown[],
  profileId = 'sciforge-runtime-default',
  publicModelAlias = 'sciforge-router',
) {
  const bundleDir = join(traceRoot, '2026-06-05', `resp_${requestIndex}`);
  mkdirSync(bundleDir, { recursive: true });
  const tracePath = join(bundleDir, 'trace.json');
  writeFileSync(tracePath, JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: `resp_${requestIndex}`,
    responseId: `resp_${requestIndex}`,
    profileId,
    publicModelAlias,
    modalityRefs: modalityRefs ?? [{
      id: `image_${requestIndex}`,
      kind: 'vision.image',
      source: 'ref',
      ref: material.ref,
      sha256: material.sha256,
    }],
    diagnostics: diagnosticText ? [{ summary: diagnosticText }] : undefined,
    calls: calls ?? [
      {
        role: 'visionTranslator',
        phase: 'vision-translation',
        status: 'ok',
        roleAlias: 'visionTranslator',
        providerBindingSha256: 'sha256:vision',
        wireApi: 'responses',
      },
      {
        role: 'textReasoner',
        phase: 'text-control-or-final',
        status: 'ok',
        roleAlias: 'textReasoner',
        providerBindingSha256: 'sha256:text',
        wireApi: 'chat.completions',
      },
    ],
  }, null, 2));
  if (traceMtimeMs !== undefined) {
    const date = new Date(traceMtimeMs);
    utimesSync(tracePath, date, date);
  }
}

function traceRefSha256(ref: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(ref).digest('hex')}`;
}

function passingAnswerForCase(caseId: string | undefined) {
  if (caseId === 'scientific-chart-legend-axis') {
    return [
      'The chart title is RESPONSE BY CONDITION.',
      'It uses TIMEPOINT on the x axis and MEAN SIGNAL on the y axis.',
      'The legend distinguishes CONTROL and TREATED groups, and the treated series includes uncertainty markers or error bars.',
    ].join(' ');
  }
  if (caseId === 'microscopy-experimental-contrast') {
    return [
      'The microscopy panel compares CONTROL and TREATED sample regions.',
      'Visible annotations call out bright puncta and nuclei outlines.',
      'The treated panel shows a contrast shift or difference, without inventing measurements.',
    ].join(' ');
  }
  if (caseId === 'ui-screenshot-state') {
    return [
      'The SCIFORGE WORKBENCH screenshot shows the CHAT surface with an ACTIVE RUN.',
      'The visible status says RUNNING.',
      'Controls include Plan, Debug, Multitask, Image, and Models, with REFERENCES or ref entries on the side.',
    ].join(' ');
  }
  if (caseId === 'dense-annotated-small-text') {
    return [
      'The title reads DENSE ANNOTATED FIELD MAP.',
      'A LEGEND lists CLASS entries, while AXIS X is REGION INDEX and AXIS Y is SIGNAL LOCALITY.',
      'The small text confidence is mixed, so small labels should be treated as uncertain.',
    ].join(' ');
  }
  return 'The image answer describes visible evidence, uncertainty, labels, and referenced controls without raw image bytes.';
}

function runNodeCli(args: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
