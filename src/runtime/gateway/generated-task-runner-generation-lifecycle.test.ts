import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import type { BackendGenerationResponse, GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeEvent } from '../runtime-types.js';
import {
  completeBackendGenerationFailureLifecycle,
  literatureDirectPayloadRecoveryReason,
  resolveGeneratedTaskGenerationRetryLifecycle,
  type GeneratedTaskGenerationLifecycleDeps,
} from './generated-task-runner-generation-lifecycle.js';
import { setBrowserAutomationForTests, setPdfTextExtractionForTests } from '../../../packages/workers/web-worker/src/web-tools.js';

const readyWebProviderRequest: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'fresh literature run: search recent papers and summarize evidence.',
  selectedToolIds: ['web_search'],
  artifacts: [],
  uiState: {
    sessionId: 'fresh-literature-provider-first-retry',
    capabilityProviderAvailability: [{
      id: 'sciforge.web-worker.web_search',
      available: true,
      status: 'available',
    }],
  },
};

const skill = {
  id: 'literature-agentserver-generation',
  kind: 'package',
  available: true,
  reason: 'test',
  checkedAt: '2026-05-16T00:00:00.000Z',
  manifestPath: '/tmp/skill.json',
  manifest: {
    id: 'literature-agentserver-generation',
    kind: 'skill',
    label: 'Literature',
    description: 'test',
    entrypoint: { type: 'agentserver-generation' },
  },
} as unknown as SkillAvailability;

test('generation lifecycle routes provider-first payload preflight violations to recovery adapter', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-provider-first-preflight-recovery-'));
  const events: WorkspaceRuntimeEvent[] = [];

  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: readyWebProviderRequest,
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-direct-network',
      response: directNetworkGeneration('.sciforge/tasks/direct-network.py'),
    },
    callbacks: {
      onEvent: (event) => events.push(event),
    },
    deps: depsWithRetry(async () => {
      throw new Error('provider-first recovery should not require an AgentServer strict retry');
    }),
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'initial-direct-network');
  assert.match(result.generation.response.patchSummary ?? '', /provider-first contract violation/i);
  const source = result.generation.response.taskFiles[0]?.content ?? '';
  assert.match(source, /invoke_capability/);
  assert.match(source, /_search_query/);
  assert.match(source, /arxiv_ids = re\.findall/);
  assert.match(source, /do\\s\+not\|don/);
  assert.match(source, /provider metadata is not full-text verified evidence/);
  assert.match(source, /"status": "failed-with-reason"/);
  assert.doesNotMatch(source, /"status": "done", "tool": "invoke_capability"/);
  assert.doesNotMatch(source, /import\s+requests|import\s+urllib|requests\.|urllib\.request/);
  assert.equal(events.some((event) => /direct provider bypass/.test(event.message ?? '')), true);
});

test('generation lifecycle retries when entrypoint path does not match materialized task files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-entrypoint-missing-retry-'));
  const events: WorkspaceRuntimeEvent[] = [];
  const strictRetryReasons: string[] = [];

  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: {
      skillDomain: 'knowledge',
      prompt: 'analyze a pasted TSV and write reproducible artifacts',
      artifacts: [],
      uiState: { sessionId: 'entrypoint-missing-retry' },
    },
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-entrypoint-missing',
      response: {
        ...generation('analysis/run.tsv_analysis.py', [
          'import json, sys',
          '_, input_path, output_path = sys.argv',
          'payload = {"message": "ok", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
          'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
        ].join('\n')),
        entrypoint: { language: 'python', path: 'analysis/run.tsv_/run.tsv_analysis.py' },
      },
    },
    callbacks: {
      onEvent: (event) => events.push(event),
    },
    deps: depsWithRetry(async (params) => {
      strictRetryReasons.push(params.strictTaskFilesReason ?? '');
      return {
        ok: true,
        runId: 'retry-entrypoint-present',
        response: generation('analysis/run.tsv_analysis.py', [
          'import json, sys',
          '_, input_path, output_path = sys.argv',
          'payload = {"message": "ok", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
          'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
        ].join('\n')),
      };
    }),
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'retry-entrypoint-present');
  assert.match(strictRetryReasons[0] ?? '', /entrypoint path is not materialized/i);
  assert.equal((strictRetryReasons[0] ?? '').includes('analysis/run.tsv_analysis.py'), true);
  assert.equal(events.some((event) => /entrypoint path is not materialized/i.test(event.message ?? '')), true);
});

test('generation lifecycle provider-first adapter is deterministic for repeated bypasses', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-provider-first-preflight-still-blocked-'));
  const events: WorkspaceRuntimeEvent[] = [];
  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: readyWebProviderRequest,
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-direct-network',
      response: directNetworkGeneration('.sciforge/tasks/direct-network.py'),
    },
    deps: depsWithRetry(async () => ({
      ok: true,
      runId: 'retry-still-direct-network',
      response: directNetworkGeneration('.sciforge/tasks/direct-network-retry.py'),
    })),
    callbacks: {
      onEvent: (event) => events.push(event),
    },
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'initial-direct-network');
  assert.match(result.generation.response.patchSummary ?? '', /provider-first contract violation/i);
  const source = result.generation.response.taskFiles[0]?.content ?? '';
  assert.match(source, /invoke_capability/);
  assert.match(source, /provider_result_is_empty/);
  assert.match(source, /full-text\/PDF retrieval, citation verification, and task-specific evidence grounding were not completed/i);
  assert.match(source, /"claimType": "failed-with-reason"/);
  assert.doesNotMatch(source, /import\s+requests|import\s+urllib|requests\.|urllib\.request/);
  assert.equal(events.some((event) => /deterministic provider-first recovery adapter/.test(event.message ?? '')), true);
});

test('generation lifecycle retries generic payload preflight violations before execution', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-payload-preflight-retry-'));
  const events: WorkspaceRuntimeEvent[] = [];
  const strictRetryReasons: string[] = [];

  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: {
      skillDomain: 'knowledge',
      prompt: 'generate clinical CSV artifacts and a markdown report',
      artifacts: [],
      expectedArtifactTypes: ['csv', 'markdown'],
      uiState: { sessionId: 'payload-preflight-retry' },
    },
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-missing-claims',
      response: generation('.sciforge/tasks/missing-claims.py', [
        'import json, sys',
        '_, input_path, output_path = sys.argv',
        'payload = {"message": "ok", "confidence": 0.8, "claimType": "analysis", "evidenceLevel": "runtime", "reasoningTrace": input_path, "uiManifest": [], "executionUnits": [], "artifacts": []}',
        'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
      ].join('\n')),
    },
    callbacks: {
      onEvent: (event) => events.push(event),
    },
    deps: depsWithRetry(async (params) => {
      strictRetryReasons.push(params.strictTaskFilesReason ?? '');
      return {
        ok: true,
        runId: 'retry-with-claims',
        response: generation('.sciforge/tasks/with-claims.py', [
          'import json, sys',
          '_, input_path, output_path = sys.argv',
          'payload = {"message": "ok", "confidence": 0.8, "claimType": "analysis", "evidenceLevel": "runtime", "reasoningTrace": input_path, "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
          'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
        ].join('\n')),
      };
    }),
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'retry-with-claims');
  assert.match(strictRetryReasons[0] ?? '', /required ToolPayload envelope fields: claims/);
  assert.equal(events.some((event) => /payload preflight/i.test(event.message ?? '')), true);
  assert.equal(events.some((event) => /complete ToolPayload envelope/.test(event.detail ?? '')), true);
});

test('generation lifecycle converts repeated literature task-interface failures into provider-backed metadata adapter', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-interface-contract-adapter-'));
  const events: WorkspaceRuntimeEvent[] = [];
  const strictRetryReasons: string[] = [];

  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: {
      skillDomain: 'literature',
      prompt: 'write a full text literature report with evidence matrix',
      artifacts: [],
      expectedArtifactTypes: ['research-report', 'evidence-matrix'],
      uiState: { sessionId: 'interface-contract-adapter' },
    },
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-static-report',
      response: generation('literature_review_task.py', [
        'import json',
        'papers = [{"title": "static paper"}]',
        'print(json.dumps({"message": "static report", "papers": papers}))',
      ].join('\n')),
    },
    callbacks: {
      onEvent: (event) => events.push(event),
    },
    deps: depsWithRetry(async (params) => {
      strictRetryReasons.push(params.strictTaskFilesReason ?? '');
      return {
        ok: true,
        runId: 'retry-still-static-report',
        response: generation('literature_review_task.py', [
          'report = "# Static report"',
          'print(report)',
        ].join('\n')),
      };
    }),
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'retry-still-static-report');
  assert.match(result.generation.response.patchSummary ?? '', /provider-backed metadata report adapter/i);
  const source = result.generation.response.taskFiles[0]?.content ?? '';
  assert.match(source, /input_path/);
  assert.match(source, /output_path/);
  assert.match(source, /invoke_capability/);
  assert.match(source, /paper-list/);
  assert.match(source, /evidence-matrix/);
  assert.match(source, /research-report/);
  assert.match(source, /notebook-timeline/);
  assert.match(source, /fullTextStatus/);
  assert.match(source, /browser_fetch/);
  assert.match(source, /_ready_capability_ids/);
  assert.match(source, /topic_match/);
  assert.match(source, /\?:on\|about\|for/);
  assert.match(source, /date_prefix = "today "/);
  assert.match(source, /evidenceLocation/);
  assert.match(source, /fetched_count/);
  assert.match(source, /provider-grounded-metadata/);
  assert.doesNotMatch(source, /static paper/);
  assert.match(strictRetryReasons[0] ?? '', /write the SciForge outputPath argument/);
  assert.equal(events.some((event) => /deterministic literature metadata provider adapter/i.test(event.message ?? '')), true);
});

test('generation lifecycle keeps deterministic failed-with-reason adapter for non-literature interface failures', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-interface-contract-generic-adapter-'));

  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: {
      skillDomain: 'knowledge',
      prompt: 'write a compact data normalization script',
      artifacts: [],
      expectedArtifactTypes: ['json'],
      uiState: { sessionId: 'interface-contract-generic-adapter' },
    },
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-static-json',
      response: generation('normalization_task.py', [
        'print({"message": "static"})',
      ].join('\n')),
    },
    deps: depsWithRetry(async () => ({
      ok: true,
      runId: 'retry-still-static-json',
      response: generation('normalization_task.py', [
        'print({"message": "still static"})',
      ].join('\n')),
    })),
  });

  assert.equal(result.kind, 'task-files');
  const source = result.generation.response.taskFiles[0]?.content ?? '';
  assert.match(result.generation.response.patchSummary ?? '', /deterministic failed-with-reason ToolPayload adapter/i);
  assert.match(source, /failed-with-reason/);
  assert.match(source, /generated-task-interface-contract/);
  assert.doesNotMatch(source, /paper-list/);
});

test('literature direct payload recovery detects partial placeholder survey outputs', () => {
  const reason = literatureDirectPayloadRecoveryReason({
    skillDomain: 'literature',
    prompt: 'latest papers with paper-list, evidence-matrix, Chinese research-report, PDF availability',
    artifacts: [],
    expectedArtifactTypes: ['paper-list', 'evidence-matrix', 'research-report'],
  }, {
    message: 'Due to harness budget I can search for papers but cannot fetch full texts or generate a full report.',
    confidence: 0.7,
    claimType: 'survey',
    evidenceLevel: 'partial',
    reasoningTrace: 'Budget exhausted after one network call.',
    claims: [],
    uiManifest: [{ componentId: 'paper-card-list', artifactRef: 'artifact-paper-search-results' }],
    executionUnits: [{ id: 'search-papers', status: 'done', tool: 'browser-search' }],
    artifacts: [{
      id: 'artifact-paper-search-results',
      type: 'paper-list',
      data: { papers: [{ title: '(placeholder) Diffusion Models', url: 'https://example.com/paper1' }] },
    }],
    displayIntent: { status: 'partial', taskOutcome: 'needs-work' },
  });

  assert.match(reason ?? '', /bounded provider recovery/i);
});

test('generation lifecycle retries Python syntax preflight violations before execution', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-syntax-preflight-retry-'));
  const events: WorkspaceRuntimeEvent[] = [];
  const strictRetryReasons: string[] = [];

  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: {
      skillDomain: 'knowledge',
      prompt: 'generate a reproducible messy TSV analysis package',
      artifacts: [],
      expectedArtifactTypes: ['csv', 'markdown', 'chart'],
      uiState: { sessionId: 'syntax-preflight-retry' },
    },
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-syntax-error',
      response: generation('.sciforge/tasks/bad-syntax.py', [
        'import json, sys',
        '_, input_path, output_path = sys.argv',
        'df´l = 1',
        'open(output_path, "w", encoding="utf-8").write(json.dumps({"message": "ok", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}))',
      ].join('\n')),
    },
    callbacks: {
      onEvent: (event) => events.push(event),
    },
    deps: depsWithRetry(async (params) => {
      strictRetryReasons.push(params.strictTaskFilesReason ?? '');
      return {
        ok: true,
        runId: 'retry-valid-syntax',
        response: generation('.sciforge/tasks/valid-syntax.py', [
          'import json, sys',
          '_, input_path, output_path = sys.argv',
          'payload = {"message": "ok", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
          'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
        ].join('\n')),
      };
    }),
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'retry-valid-syntax');
  assert.match(strictRetryReasons[0] ?? '', /failed syntax preflight/i);
  assert.match(strictRetryReasons[0] ?? '', /invalid character/i);
  assert.equal(events.some((event) => /syntax preflight/i.test(event.message ?? '')), true);
});

test('generation lifecycle retries payload preflight again when strict retry surfaces outputPath directory misuse', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-payload-preflight-second-retry-'));
  let retryCount = 0;
  const strictRetryReasons: string[] = [];

  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: {
      skillDomain: 'knowledge',
      prompt: 'generate clinical CSV artifacts and a markdown report',
      artifacts: [],
      uiState: { sessionId: 'payload-preflight-second-retry' },
    },
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-missing-claims',
      response: generation('.sciforge/tasks/missing-claims.py', [
        'import json, sys',
        '_, input_path, output_path = sys.argv',
        'payload = {"message": "ok", "uiManifest": [], "executionUnits": [], "artifacts": []}',
        'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
      ].join('\n')),
    },
    deps: depsWithRetry(async (params) => {
      retryCount += 1;
      strictRetryReasons.push(params.strictTaskFilesReason ?? '');
      if (retryCount === 1) {
        return {
          ok: true,
          runId: 'retry-outputpath-as-dir',
          response: generation('.sciforge/tasks/outputpath-as-dir.py', [
            'import json, sys',
            'from pathlib import Path',
            '_, input_path, output_path = sys.argv',
            'output_dir = Path(output_path)',
            'output_dir.mkdir(parents=True, exist_ok=True)',
            'raw_csv = output_dir / "raw.csv"',
            'payload = {"message": "ok", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": [{"id": "raw", "type": "csv", "path": str(raw_csv)}]}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n')),
        };
      }
      return {
        ok: true,
        runId: 'retry-outputpath-parent',
        response: generation('.sciforge/tasks/outputpath-parent.py', [
          'import json, sys',
          'from pathlib import Path',
          '_, input_path, output_path = sys.argv',
          'output_dir = Path(output_path).parent / "clinical-analysis-output"',
          'output_dir.mkdir(parents=True, exist_ok=True)',
          'raw_csv = output_dir / "raw.csv"',
          'payload = {"message": "ok", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": [{"id": "raw", "type": "csv", "path": str(raw_csv)}]}',
          'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
        ].join('\n')),
      };
    }),
  });

  assert.equal(result.kind, 'task-files');
  assert.equal(result.generation.runId, 'retry-outputpath-parent');
  assert.equal(retryCount, 2);
  assert.match(strictRetryReasons[0] ?? '', /claims/);
  assert.match(strictRetryReasons[1] ?? '', /outputPath.*directory/i);
});

test('generation lifecycle returns repair payload when payload preflight retry is still invalid', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-payload-preflight-still-invalid-'));

  const result = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl: 'http://127.0.0.1:18080',
    request: {
      skillDomain: 'knowledge',
      prompt: 'generate clinical CSV artifacts and a markdown report',
      artifacts: [],
      uiState: { sessionId: 'payload-preflight-still-invalid' },
    },
    skill,
    skills: [skill],
    workspace,
    generation: {
      ok: true,
      runId: 'initial-missing-claims',
      response: generation('.sciforge/tasks/missing-claims.py', [
        'import json, sys',
        '_, input_path, output_path = sys.argv',
        'payload = {"message": "ok", "uiManifest": [], "executionUnits": [], "artifacts": []}',
        'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
      ].join('\n')),
    },
    deps: depsWithRetry(async () => ({
      ok: true,
      runId: 'retry-still-missing-claims',
      response: generation('.sciforge/tasks/still-missing-claims.py', [
        'import json, sys',
        '_, input_path, output_path = sys.argv',
        'payload = {"message": "still missing", "uiManifest": [], "executionUnits": [], "artifacts": []}',
        'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
      ].join('\n')),
    })),
  });

  assert.equal(result.kind, 'payload');
  assert.match(result.payload.message, /strict retry still failed payload preflight/i);
  assert.match(result.payload.message, /claims/);
});

test('generation failure lifecycle exposes AgentServer side-effect writes as unverified completion candidates', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-side-effect-candidate-'));
  const candidatePath = join(workspace, 'fixed_inverse_square_decay.py');
  await writeFile(candidatePath, 'def fixed_inverse_square_decay(x):\n    return 1 / (1 + x * x)\n');

  const payload = await completeBackendGenerationFailureLifecycle({
    workspace,
    request: readyWebProviderRequest,
    skill,
    generation: {
      ok: false,
      error: 'backend generation stopped by convergence guard after 214465 total tokens.',
      diagnostics: {
        kind: 'agentserver',
        originalErrorSummary: 'bounded generation stopped',
        sideEffectWorkEvidence: [{
          kind: 'write',
          status: 'success',
          input: { path: candidatePath },
          outputSummary: 'Wrote repaired script before terminal response failed.',
          evidenceRefs: [candidatePath],
          recoverActions: [],
          rawRef: candidatePath,
        }],
      },
    },
    deps: {
      ...depsWithRetry(async () => {
        throw new Error('failure lifecycle should not retry generation');
      }),
      repairNeededPayload: (_request, _skill, reason, _refs) => repairPayload(reason),
      backendGenerationFailureReason: (error) => error,
      backendFailurePayloadRefs: () => ({}),
    },
  });

  const displayIntent = payload.displayIntent as Record<string, any> | undefined;
  const completionCandidate = displayIntent?.completionCandidate as Record<string, any> | undefined;
  assert.equal(completionCandidate?.schemaVersion, 'sciforge.completion-candidate.v1');
  assert.equal(completionCandidate?.status, 'unverified');
  assert.deepEqual(completionCandidate?.auditRefs, ['fixed_inverse_square_decay.py']);
  assert.deepEqual(completionCandidate?.artifactRefs, ['artifact:agentserver-candidate-fixed-inverse-square-decay-py']);
  assert.equal(payload.artifacts.some((artifact) => {
    const delivery = artifact.delivery as Record<string, unknown> | undefined;
    return artifact.id === 'agentserver-candidate-fixed-inverse-square-decay-py'
      && delivery?.role === 'supporting-evidence'
      && typeof delivery?.rawRef === 'string';
  }), true);
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(payload.message, /needs repair|backend generation/i);
  assert.notEqual(payload.claimType, 'satisfied');
});

test('generation failure lifecycle recovers literature generation failures through providers', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-literature-generation-failure-recovery-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('duckduckgo.com/html/')) {
      return new Response('temporary search failure', { status: 503 });
    }
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2605.18888v1</id>
            <updated>2026-05-18T10:00:00Z</updated>
            <published>2026-05-18T10:00:00Z</published>
            <title>Agent Computer Use Beyond the Browser</title>
            <summary>Recent systems for agent computer use.</summary>
            <author><name>Grace Hopper</name></author>
            <link href="https://arxiv.org/abs/2605.18888v1" rel="alternate" type="text/html"/>
            <link title="pdf" href="https://arxiv.org/pdf/2605.18888v1" rel="related" type="application/pdf"/>
          </entry>
        </feed>`, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    }
    if (href.includes('arxiv.org/abs/2605.18888v1')) {
      return new Response('<html><title>Agent Computer Use Beyond the Browser</title><body>Abstract. Recent systems for agent computer use. <a href="https://arxiv.org/pdf/2605.18888v1.pdf">PDF</a></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (href.includes('arxiv.org/pdf/2605.18888v1')) {
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  setPdfTextExtractionForTests({
    async extract(input) {
      assert.match(input.url, /2605\.18888v1/);
      return {
        status: 'extracted',
        extractor: 'test-pdf',
        pageRange: '1-8',
        evidenceLocations: [`${input.url}#page=1`],
        charsExtracted: 96,
        text: 'PDF page 1: Agent computer use systems extend beyond browser-only tasks and require desktop evidence.',
        truncated: false,
      };
    },
  });

  try {
    const payload = await completeBackendGenerationFailureLifecycle({
      workspace,
      request: {
        skillDomain: 'literature',
        prompt: 'Today is 2026-05-18. Research today arxiv papers about agent computer use. Read full text or PDF. Write a Chinese report artifact.',
        artifacts: [],
        expectedArtifactTypes: ['paper-list', 'evidence-matrix', 'research-report'],
        uiState: { sessionId: 'literature-generation-failure-recovery' },
      },
      skill,
      generation: {
        ok: false,
        error: 'Backend generation returned a malformed or incomplete GeneratedTaskResponse-looking JSON payload.',
        diagnostics: {
          kind: 'agentserver',
          originalErrorSummary: 'malformed generation response',
          sideEffectWorkEvidence: [{
            kind: 'write',
            status: 'success',
            input: { path: join(workspace, 'malformed_generation_debug.json') },
            outputSummary: 'Malformed generation text was preserved for audit, not as a user deliverable.',
            evidenceRefs: [join(workspace, 'malformed_generation_debug.json')],
            recoverActions: [],
          }],
        },
      },
      deps: {
        ...depsWithRetry(async () => {
          throw new Error('failure lifecycle should not retry generation');
        }),
        repairNeededPayload: (_request, _skill, reason, _refs) => repairPayload(reason),
        backendGenerationFailureReason: (error) => error,
        backendFailurePayloadRefs: () => ({}),
      },
    });

    assert.match(payload.message, /web_search\/web_fetch\/pdf_extract provider fallback/);
    assert.equal(payload.claimType, 'literature-survey');
    assert.equal(payload.displayIntent?.status, 'completed');
    assert.equal(payload.displayIntent?.taskOutcome, 'satisfied');
    assert.match(JSON.stringify(payload.executionUnits), /Called web_search/);
    assert.match(JSON.stringify(payload.executionUnits), /extracted 1 PDFs/);
    const report = payload.artifacts.find((artifact) => artifact.id === 'research-report');
    assert.ok(report);
    assert.equal((report.delivery as Record<string, unknown> | undefined)?.previewPolicy, 'inline');
    assert.match(String((report.delivery as Record<string, unknown> | undefined)?.readableRef ?? ''), /research-report\.md$/);
    assert.match(JSON.stringify(payload), /Agent Computer Use Beyond the Browser/);
    assert.match(JSON.stringify(payload), /PDF extracted via pdf_extract/);
    assert.doesNotMatch(payload.message, /malformed or incomplete/);
  } finally {
    globalThis.fetch = originalFetch;
    setPdfTextExtractionForTests(undefined);
  }
});

test('generation failure no-result recovery uses the requested topic instead of hard-coded arXiv copy', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-literature-generation-empty-recovery-'));
  const originalFetch = globalThis.fetch;
  setBrowserAutomationForTests({
    async search() {
      return { provider: 'test-browser', results: [] };
    },
    async fetch() {
      throw new Error('browser fetch should not run');
    },
  });
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('duckduckgo.com/html/')) {
      return new Response('<html><body>No results</body></html>', { status: 200 });
    }
    if (href.includes('europepmc.org')) {
      return new Response(JSON.stringify({ resultList: { result: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (href.includes('api.crossref.org')) {
      return new Response(JSON.stringify({ message: { items: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;

  try {
    const payload = await completeBackendGenerationFailureLifecycle({
      workspace,
      request: {
        skillDomain: 'literature',
        prompt: 'Research recent PubMed papers about mitochondrial calcium oscillation sensors. Read full text or PDF if available. Write a Chinese report artifact.',
        artifacts: [],
        expectedArtifactTypes: ['paper-list', 'evidence-matrix', 'research-report'],
        uiState: { sessionId: 'literature-empty-result-recovery' },
      },
      skill,
      generation: {
        ok: false,
        error: 'backend returned malformed generation response',
        diagnostics: { kind: 'agentserver', originalErrorSummary: 'malformed generation response' },
      },
      deps: {
        ...depsWithRetry(async () => {
          throw new Error('failure lifecycle should not retry generation');
        }),
        repairNeededPayload: (_request, _skill, reason, _refs) => repairPayload(reason),
        backendGenerationFailureReason: (error) => error,
        backendFailurePayloadRefs: () => ({}),
      },
    });

    assert.equal(payload.claimType, 'literature-survey');
    assert.match(payload.message, /mitochondrial calcium oscillation sensors/i);
    assert.doesNotMatch(payload.message, /agent computer use|今天 arXiv|today arXiv/i);
    assert.doesNotMatch(JSON.stringify(payload.artifacts), /agent computer use/i);
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserAutomationForTests(undefined);
  }
});

test('generation retry lifecycle recovers literature strict retry failures through providers', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-literature-strict-retry-recovery-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('duckduckgo.com/html/')) {
      return new Response('temporary search failure', { status: 503 });
    }
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2605.19999v1</id>
            <updated>2026-05-18T11:00:00Z</updated>
            <published>2026-05-18T11:00:00Z</published>
            <title>Reliable Agent Computer Use Evaluation</title>
            <summary>Evaluation methods for agents using computers.</summary>
            <author><name>Ada Lovelace</name></author>
            <link href="https://arxiv.org/abs/2605.19999v1" rel="alternate" type="text/html"/>
            <link title="pdf" href="https://arxiv.org/pdf/2605.19999v1" rel="related" type="application/pdf"/>
          </entry>
        </feed>`, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    }
    if (href.includes('arxiv.org/abs/2605.19999v1')) {
      return new Response('<html><title>Reliable Agent Computer Use Evaluation</title><body>Abstract. Evaluation methods for agents using computers. <a href="https://arxiv.org/pdf/2605.19999v1.pdf">PDF</a></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (href.includes('arxiv.org/pdf/2605.19999v1')) {
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  setPdfTextExtractionForTests({
    async extract(input) {
      assert.match(input.url, /2605\.19999v1/);
      return {
        status: 'extracted',
        extractor: 'test-pdf',
        pageRange: '1-8',
        evidenceLocations: [`${input.url}#page=1`],
        charsExtracted: 88,
        text: 'PDF page 1: Reliable agent computer use evaluation studies task fidelity and evidence quality.',
        truncated: false,
      };
    },
  });

  try {
    const result = await resolveGeneratedTaskGenerationRetryLifecycle({
      baseUrl: 'http://127.0.0.1:18080',
      request: {
        skillDomain: 'literature',
        prompt: 'Today is 2026-05-18. Research today arxiv papers about agent computer use. Read full text or PDF. Write a Chinese report artifact.',
        artifacts: [],
        expectedArtifactTypes: ['paper-list', 'evidence-matrix', 'research-report'],
        uiState: { sessionId: 'literature-strict-retry-recovery' },
      },
      skill,
      skills: [skill],
      workspace,
      generation: {
        ok: true,
        runId: 'initial-entrypoint-missing',
        response: {
          ...generation('analysis/research_task.py', [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'open(output_path, "w", encoding="utf-8").write(json.dumps({"message": "ok"}))',
          ].join('\n')),
          entrypoint: { language: 'python', path: 'analysis/missing_research_task.py' },
        },
      },
      deps: depsWithRetry(async () => ({
        ok: false,
        error: 'Backend generation returned a malformed or incomplete GeneratedTaskResponse-looking JSON payload.',
        diagnostics: { kind: 'agentserver', originalErrorSummary: 'malformed retry generation response' },
      })),
    });

    assert.equal(result.kind, 'payload');
    assert.match(result.payload.message, /web_search\/web_fetch\/pdf_extract provider fallback/);
    assert.equal(result.payload.claimType, 'literature-survey');
    assert.equal(result.payload.displayIntent?.taskOutcome, 'satisfied');
    assert.match(JSON.stringify(result.payload.executionUnits), /Called web_search/);
    assert.match(JSON.stringify(result.payload.executionUnits), /extracted 1 PDFs/);
    const report = result.payload.artifacts.find((artifact) => artifact.id === 'research-report');
    assert.ok(report);
    assert.equal((report.delivery as Record<string, unknown> | undefined)?.previewPolicy, 'inline');
    assert.match(String((report.delivery as Record<string, unknown> | undefined)?.readableRef ?? ''), /research-report\.md$/);
    assert.match(JSON.stringify(result.payload), /Reliable Agent Computer Use Evaluation/);
    assert.match(JSON.stringify(result.payload), /PDF extracted via pdf_extract/);
    assert.doesNotMatch(result.payload.message, /malformed or incomplete/);
  } finally {
    globalThis.fetch = originalFetch;
    setPdfTextExtractionForTests(undefined);
  }
});

function depsWithRetry(
  requestBackendGeneration: GeneratedTaskGenerationLifecycleDeps['requestBackendGeneration'],
): GeneratedTaskGenerationLifecycleDeps {
  return {
    requestBackendGeneration,
    attemptPlanRefs: () => ({}),
    repairNeededPayload: (_request, _skill, reason) => repairPayload(reason),
    ensureDirectAnswerReportArtifact: (payload) => payload,
    mergeReusableContextArtifactsForDirectPayload: async (payload) => payload,
    validateAndNormalizePayload: async (payload) => payload,
    firstPayloadFailureReason: () => undefined,
    payloadHasFailureStatus: () => false,
  };
}

function repairPayload(reason: string): ToolPayload {
  return {
    message: reason,
    confidence: 0.2,
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'runtime',
    reasoningTrace: reason,
    claims: [{ statement: reason, confidence: 0.2 }],
    uiManifest: [],
    executionUnits: [{
      id: 'provider-first-preflight-repair',
      status: 'repair-needed',
      tool: 'sciforge.generated-task-generation-lifecycle',
      failureReason: reason,
    }],
    artifacts: [],
  };
}

function directNetworkGeneration(path: string): BackendGenerationResponse {
  return generation(path, [
    'import json, sys, urllib.request',
    'input_path = sys.argv[1]',
    'output_path = sys.argv[2]',
    'urllib.request.urlopen("https://example.com", timeout=5)',
    'payload = {"message": "ok", "confidence": 0.5, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": input_path, "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
    'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
  ].join('\n'));
}

function generation(path: string, content: string): BackendGenerationResponse {
  return {
    taskFiles: [{ path, language: 'python', content }],
    entrypoint: { language: 'python', path },
    environmentRequirements: {},
    validationCommand: '',
    expectedArtifacts: [],
    patchSummary: 'test generation',
  };
}
