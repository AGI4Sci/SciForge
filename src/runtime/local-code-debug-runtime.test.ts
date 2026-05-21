import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runWorkspaceRuntimeGateway } from './generation-gateway.js';
import { tryRunLocalCodeDebugRuntime } from './local-code-debug-runtime.js';

test('local code debug runtime runs pytest, patches bounded MMD fixture, and reruns tests', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-'));
  await writeFile(join(workspace, 'paper_metric_kernel.py'), [
    'import numpy as np',
    '',
    '',
    'def pairwise_sq_dists(x: np.ndarray, y: np.ndarray) -> np.ndarray:',
    '    x = np.asarray(x, dtype=float)',
    '    y = np.asarray(y, dtype=float)',
    '    return ((x[:, None, :] - y[None, :, :]) ** 2).sum(axis=2)',
    '',
    '',
    'def inverse_multiquadric_kernel(x: np.ndarray, y: np.ndarray, c: float = 1.0) -> np.ndarray:',
    '    """Kernel used in the paper reproduction note: k(x, y)=1/sqrt(||x-y||^2+c^2)."""',
    '    d2 = pairwise_sq_dists(x, y)',
    '    return 1.0 / (d2 + c ** 2)',
    '',
    '',
    'def mmd2_unbiased(x: np.ndarray, y: np.ndarray, c: float = 1.0) -> float:',
    '    kxx = inverse_multiquadric_kernel(x, x, c)',
    '    kyy = inverse_multiquadric_kernel(y, y, c)',
    '    kxy = inverse_multiquadric_kernel(x, y, c)',
    '    n = x.shape[0]',
    '    m = y.shape[0]',
    '    return (',
    '        (kxx.sum() - np.trace(kxx)) / (n * (n - 1))',
    '        + (kyy.sum() - np.trace(kyy)) / (m * (m - 1))',
    '        - 2.0 * kxy.mean()',
    '    )',
    '',
  ].join('\n'));
  await writeFile(join(workspace, 'test_kernel_mmd.py'), [
    'import numpy as np',
    'from paper_metric_kernel import inverse_multiquadric_kernel, mmd2_unbiased',
    '',
    'def test_inverse_multiquadric_matches_paper_definition():',
    '    observed = inverse_multiquadric_kernel(np.array([[0.0], [3.0]]), np.array([[4.0]]), c=2.0).ravel()',
    '    np.testing.assert_allclose(observed, [1 / np.sqrt(20.0), 1 / np.sqrt(5.0)])',
    '',
    'def test_mmd2_is_near_zero_for_identical_samples():',
    '    x = np.array([[0.0], [1.0], [2.0], [3.0]])',
    '    assert abs(mmd2_unbiased(x, x, c=1.0)) < 1e-12',
    '',
  ].join('\n'));

  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'Debug paper_metric_kernel.py: first run python -m pytest test_kernel_mmd.py -q, identify root cause, patch code, rerun tests, and report remaining risks.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {},
  });

  assert.ok(payload);
  assert.match(payload.message, /Patch summary:/);
  assert.match(payload.message, /Rerun: `python -m pytest test_kernel_mmd.py -q` -> passed/);
  assert.equal(payload.executionUnits.at(-1)?.status, 'done');
  const source = await readFile(join(workspace, 'paper_metric_kernel.py'), 'utf8');
  assert.match(source, /np\.sqrt\(d2 \+ c \*\* 2\)/);
  assert.match(source, /return float\(kxx\.mean\(\) \+ kyy\.mean\(\) - 2\.0 \* kxy\.mean\(\)\)/);
});

test('local code debug repair rules are evidence-driven and not fixture-name specific', async () => {
  const source = await readFile(new URL('./local-code-debug-runtime.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /inverse_multiquadric|mmd2_unbiased/);

  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-general-'));
  await writeFile(join(workspace, 'stats_impl.py'), [
    'import numpy as np',
    '',
    'def pairwise_sq_dists(a, b):',
    '    a = np.asarray(a, dtype=float)',
    '    b = np.asarray(b, dtype=float)',
    '    return ((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=2)',
    '',
    'def doc_kernel(a, b, bandwidth=1.0):',
    '    """Contract: k(a,b)=1/sqrt(||a-b||^2+bandwidth^2)."""',
    '    squared = pairwise_sq_dists(a, b)',
    '    return 1.0 / (squared + bandwidth ** 2)',
    '',
    'def two_sample_distance(left, right, bandwidth=1.0):',
    '    aa = doc_kernel(left, left, bandwidth)',
    '    bb = doc_kernel(right, right, bandwidth)',
    '    ab = doc_kernel(left, right, bandwidth)',
    '    n = left.shape[0]',
    '    m = right.shape[0]',
    '    return (aa.sum() - np.trace(aa)) / (n * (n - 1)) + (bb.sum() - np.trace(bb)) / (m * (m - 1)) - 2.0 * ab.mean()',
    '',
  ].join('\n'));
  await writeFile(join(workspace, 'test_stats_impl.py'), [
    'import numpy as np',
    'from stats_impl import doc_kernel, two_sample_distance',
    '',
    'def test_doc_kernel_uses_square_root_denominator():',
    '    got = doc_kernel(np.array([[0.0], [3.0]]), np.array([[4.0]]), bandwidth=2.0).ravel()',
    '    np.testing.assert_allclose(got, [1 / np.sqrt(20.0), 1 / np.sqrt(5.0)])',
    '',
    'def test_two_sample_distance_zero_for_identical_inputs():',
    '    z = np.array([[0.0], [1.0], [2.0], [3.0]])',
    '    assert abs(two_sample_distance(z, z, bandwidth=1.0)) < 1e-12',
    '',
  ].join('\n'));

  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'Debug stats_impl.py: first run python -m pytest test_stats_impl.py -q, identify root cause, patch code, rerun tests, and report remaining risks.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {},
  });

  assert.ok(payload);
  assert.match(payload.message, /Rerun: `python -m pytest test_stats_impl.py -q` -> passed/);
  const repaired = await readFile(join(workspace, 'stats_impl.py'), 'utf8');
  assert.match(repaired, /return 1\.0 \/ np\.sqrt\(squared \+ bandwidth \*\* 2\)/);
  assert.match(repaired, /return float\(aa\.mean\(\) \+ bb\.mean\(\) - 2\.0 \* ab\.mean\(\)\)/);
});

test('local code debug infers implementation files from pytest test imports when prompt omits source file', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-import-infer-'));
  await writeFile(join(workspace, 'kernel_ops.py'), [
    'import numpy as np',
    '',
    'def pairwise_sq_dists(a, b):',
    '    a = np.asarray(a, dtype=float)',
    '    b = np.asarray(b, dtype=float)',
    '    return ((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=2)',
    '',
    'def doc_kernel(a, b, bandwidth=1.0):',
    '    squared = pairwise_sq_dists(a, b)',
    '    return 1.0 / (squared + bandwidth ** 2)',
    '',
  ].join('\n'));
  await writeFile(join(workspace, 'test_kernel_ops.py'), [
    'import numpy as np',
    'from kernel_ops import doc_kernel',
    '',
    'def test_doc_kernel_uses_square_root_denominator():',
    '    got = doc_kernel(np.array([[0.0], [3.0]]), np.array([[4.0]]), bandwidth=2.0).ravel()',
    '    np.testing.assert_allclose(got, [1 / np.sqrt(20.0), 1 / np.sqrt(5.0)])',
    '',
  ].join('\n'));

  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'Please run python -m pytest test_kernel_ops.py -q, identify root cause, patch the implementation code, rerun tests, and report remaining risks.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {},
  });

  assert.ok(payload);
  assert.match(payload.message, /kernel_ops\.py/);
  assert.match(payload.message, /Rerun: `python -m pytest test_kernel_ops\.py -q` -> passed/);
  const repaired = await readFile(join(workspace, 'kernel_ops.py'), 'utf8');
  assert.match(repaired, /return 1\.0 \/ np\.sqrt\(squared \+ bandwidth \*\* 2\)/);
});

test('local code debug extracts pytest command without swallowing natural-language instructions', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-command-boundary-'));
  await writeFile(join(workspace, 'kernel_ops.py'), [
    'import numpy as np',
    '',
    'def pairwise_sq_dists(a, b):',
    '    a = np.asarray(a, dtype=float)',
    '    b = np.asarray(b, dtype=float)',
    '    return ((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=2)',
    '',
    'def doc_kernel(a, b, bandwidth=1.0):',
    '    squared = pairwise_sq_dists(a, b)',
    '    return 1.0 / (squared + bandwidth ** 2)',
    '',
  ].join('\n'));
  await writeFile(join(workspace, 'test_kernel_ops.py'), [
    'import numpy as np',
    'from kernel_ops import doc_kernel',
    '',
    'def test_doc_kernel_uses_square_root_denominator():',
    '    got = doc_kernel(np.array([[0.0], [3.0]]), np.array([[4.0]]), bandwidth=2.0).ravel()',
    '    np.testing.assert_allclose(got, [1 / np.sqrt(20.0), 1 / np.sqrt(5.0)])',
    '',
  ].join('\n'));

  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'Please run exactly: python -m pytest test_kernel_ops.py -q. Locate the root cause, patch the implementation, rerun exactly: python -m pytest test_kernel_ops.py -q, and report remaining risks.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {},
  });

  assert.ok(payload);
  assert.match(payload.message, /Initial: `python -m pytest test_kernel_ops\.py -q` -> failed/);
  assert.match(payload.message, /Rerun: `python -m pytest test_kernel_ops\.py -q` -> passed/);
  assert.doesNotMatch(payload.message, /Locate the root cause/);
});

test('local code debug returns coherent repair-needed when no implementation file can be inferred', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-no-source-'));
  await writeFile(join(workspace, 'test_lonely_failure.py'), [
    'def test_lonely_failure():',
    '    assert 1 == 2',
    '',
  ].join('\n'));

  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'Run python -m pytest test_lonely_failure.py -q, find the root cause, patch code if possible, rerun tests, and report remaining risks.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {},
  });

  assert.ok(payload);
  assert.match(payload.message, /Local code-debug runtime could not complete/);
  assert.match(payload.message, /No workspace code patch was applied/);
  assert.match(payload.message, /Rerun: not executed because no bounded local patch matched the failure/);
  assert.equal(payload.executionUnits.at(-1)?.status, 'failed-with-reason');
});

test('local code debug runtime ignores prompts without explicit pytest command', async () => {
  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'Debug paper_metric_kernel.py and explain likely issues.',
    workspacePath: '/tmp/missing',
    artifacts: [],
    uiState: {},
  });

  assert.equal(payload, undefined);
});

test('local code debug follow-up summarizes prior verified artifact without backend rerun', async () => {
  const payload = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Summarize the previous repair in three bullets: root cause, patch, rerun result. Do not modify files or rerun long tasks.',
    workspacePath: '/tmp/missing',
    artifacts: [{
      id: 'local-code-debug-prior',
      type: 'research-report',
      metadata: {
        source: 'sciforge.local-code-debug.pytest-repair',
        command: 'python -m pytest test_stats_impl.py -q',
        changedRefs: ['stats_impl.py'],
      },
      data: {
        markdown: [
          'Local code-debug runtime completed the requested bounded repair without remote backend generation.',
          '',
          'Patch summary:',
          '- stats_impl.py: doc_kernel: wrapped denominator in np.sqrt because the local contract/tests expected a square-root denominator.',
          '',
          '测试结果:',
          '- Initial: `python -m pytest test_stats_impl.py -q` -> failed (exit 1)',
          '- Rerun: `python -m pytest test_stats_impl.py -q` -> passed',
          '',
          'Remaining risks:',
          '- Broader scientific validity still needs domain review.',
        ].join('\n'),
      },
    }],
    uiState: { forceAgentServerGeneration: true },
  });
  const taskRunCard = payload.displayIntent?.taskRunCard as { taskOutcome?: string } | undefined;
  const conversationProjection = payload.displayIntent?.conversationProjection as {
    visibleAnswer?: { status?: string; text?: string };
  } | undefined;

  assert.equal(taskRunCard?.taskOutcome, 'satisfied');
  assert.equal(conversationProjection?.visibleAnswer?.status, 'satisfied');
  assert.match(payload.message, /Based on the previous local code-debug result/);
  assert.match(payload.message, /python -m pytest test_stats_impl\.py -q/);
  assert.doesNotMatch(conversationProjection?.visibleAnswer?.text ?? '', /Partial result artifacts|Draft result summary|AgentServer/);
  assert.equal(payload.executionUnits[0]?.status, 'done');
});

test('local code debug follow-up can reuse bounded multi-turn message previews', async () => {
  const payload = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Use the earlier local-code-debug result above. Summarize patch summary, pytest rerun, and remaining risks. Do not modify files or run tests.',
    workspacePath: '/tmp/missing',
    artifacts: [],
    uiState: {
      forceAgentServerGeneration: true,
      sessionMessages: [{
        id: 'assistant-prior',
        role: 'assistant',
        contentPreview: [
          'Local code-debug runtime completed the requested bounded repair without remote backend generation.',
          'Patch summary:',
          '- stats_impl.py: doc_kernel: wrapped denominator in np.sqrt because the local contract/tests expected a square-root denominator.',
          '测试结果:',
          '- Initial: `python -m pytest test_stats_impl.py -q` -> failed (exit 1)',
          '- Rerun: `python -m pytest test_stats_impl.py -q` -> passed',
          'Remaining risks:',
          '- Broader scientific validity still needs domain review.',
        ].join('\n'),
      }],
    },
  });

  assert.match(payload.message, /stats_impl\.py/);
  assert.match(payload.message, /Rerun: `python -m pytest test_stats_impl\.py -q` -> passed/);
  assert.equal((payload.displayIntent?.taskRunCard as { taskOutcome?: string } | undefined)?.taskOutcome, 'satisfied');
});

test('local code debug follow-up skips polluted failed continuation records and falls back to workspace state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-polluted-history-'));
  await mkdir(join(workspace, '.sciforge'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'workspace-state.json'), JSON.stringify({
    runs: [{
      id: 'project-local-debug-success',
      response: [
        'Local code-debug runtime completed the requested bounded repair without remote backend generation.',
        '',
        'Patch summary:',
        '- metric.py: repaired the local metric implementation.',
        '',
        '测试结果:',
        '- Initial: `python -m pytest test_metric.py -q` -> failed (exit 1)',
        '- Rerun: `python -m pytest test_metric.py -q` -> passed',
        '',
        'Remaining risks:',
        '- Additional metric fixtures remain untested.',
      ].join('\n'),
    }],
  }), 'utf8');

  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'Follow-up from the previous local code-debug result: summarize patch summary, pytest rerun result, and remaining risks. Do not modify files or run tests.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {
      recentRuns: [{
        id: 'failed-followup',
        responsePreview: 'Follow-up from the previous local code-debug result failed: AgentServer generation request failed.',
        summary: 'This failed continuation mentions local-code-debug but has no reusable patch/test/risk artifact.',
      }],
      sessionMessages: [{
        id: 'failed-message',
        contentPreview: 'Patch summary: 未应用工作区代码 patch；后端在执行/生成阶段失败，不能声明已修复。',
      }],
    },
  });

  assert.ok(payload);
  assert.match(payload.message, /Based on the previous local code-debug result/);
  assert.match(payload.message, /metric\.py: repaired the local metric implementation/);
  assert.match(payload.message, /Rerun: `python -m pytest test_metric\.py -q` -> passed/);
  assert.doesNotMatch(payload.message, /AgentServer generation request failed|未应用工作区代码 patch/);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.local-code-debug.pytest-repair');
});

test('local code debug follow-up hydrates prior artifact from bounded context refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-context-ref-'));
  const artifactDir = join(workspace, '.sciforge', 'sessions', 'session-a', 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, 'local-code-debug-contextref123.json'), JSON.stringify({
    id: 'local-code-debug-contextref123',
    type: 'research-report',
    metadata: {
      source: 'sciforge.local-code-debug.pytest-repair',
      command: 'python -m pytest test_solver.py -q',
      changedRefs: ['solver.py'],
    },
    data: {
      markdown: [
        'Local code-debug runtime completed the requested bounded repair without remote backend generation.',
        '',
        'Patch summary:',
        '- solver.py: normalized the denominator using the documented square-root contract.',
        '',
        '测试结果:',
        '- Initial: `python -m pytest test_solver.py -q` -> failed (exit 1)',
        '- Rerun: `python -m pytest test_solver.py -q` -> passed',
        '',
        'Remaining risks:',
        '- Broader numerical edge cases still need review.',
      ].join('\n'),
    },
  }), 'utf8');

  const payload = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Summarize the previous local code debug result: patch summary, pytest rerun, and remaining risks. Do not modify files or run tests.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {
      forceAgentServerGeneration: true,
      agentHarnessHandoff: {
        contextRefs: {
          allowed: ['local-code-debug-contextref123'],
        },
      },
    },
  });

  assert.match(payload.message, /solver\.py/);
  assert.match(payload.message, /Rerun: `python -m pytest test_solver\.py -q` -> passed/);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.local-code-debug.pytest-repair');
  assert.equal((payload.displayIntent?.taskRunCard as { taskOutcome?: string } | undefined)?.taskOutcome, 'satisfied');
});

test('local code debug follow-up maps execution-unit refs back to report artifact id', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-eu-ref-'));
  const artifactDir = join(workspace, '.sciforge', 'sessions', 'session-eu', 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, 'local-code-debug-euref789.json'), JSON.stringify({
    id: 'local-code-debug-euref789',
    type: 'research-report',
    metadata: {
      source: 'sciforge.local-code-debug.pytest-repair',
      command: 'python -m pytest test_metric.py -q',
      changedRefs: ['metric.py'],
    },
    data: {
      markdown: [
        'Local code-debug runtime completed the requested bounded repair without remote backend generation.',
        '',
        'Patch summary:',
        '- metric.py: repaired the local metric implementation.',
        '',
        '测试结果:',
        '- Initial: `python -m pytest test_metric.py -q` -> failed (exit 1)',
        '- Rerun: `python -m pytest test_metric.py -q` -> passed',
        '',
        'Remaining risks:',
        '- Additional metric fixtures remain untested.',
      ].join('\n'),
    },
  }), 'utf8');

  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'Summarize the previous local code debug result: patch summary, pytest rerun, and remaining risks. Do not modify files or run tests.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {
      recentExecutionRefs: ['EU-local-code-debug-euref789-rerun'],
    },
  });

  assert.ok(payload);
  assert.match(payload.message, /metric\.py/);
  assert.match(payload.message, /Rerun: `python -m pytest test_metric\.py -q` -> passed/);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.local-code-debug.pytest-repair');
});

test('local code debug follow-up uses raw current prompt when enriched prompt contains prior pytest context', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-enriched-prompt-'));
  const artifactDir = join(workspace, '.sciforge', 'sessions', 'session-enriched', 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, 'local-code-debug-enriched123.json'), JSON.stringify({
    id: 'local-code-debug-enriched123',
    type: 'research-report',
    metadata: {
      source: 'sciforge.local-code-debug.pytest-repair',
      command: 'python -m pytest test_enriched.py -q',
      changedRefs: ['enriched.py'],
    },
    data: {
      markdown: [
        'Local code-debug runtime completed the requested bounded repair without remote backend generation.',
        '',
        'Patch summary:',
        '- enriched.py: reused the prior verified repair report.',
        '',
        '测试结果:',
        '- Initial: `python -m pytest test_enriched.py -q` -> failed (exit 1)',
        '- Rerun: `python -m pytest test_enriched.py -q` -> passed',
        '',
        'Remaining risks:',
        '- Only the previous bounded evidence was reused.',
      ].join('\n'),
    },
  }), 'utf8');

  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'CURRENT TURN SNAPSHOT includes prior command `python -m pytest test_enriched.py -q`, but the user is only asking a follow-up.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {
      rawUserPrompt: 'Summarize the previous local code debug result. Do not modify files or run tests.',
      recentExecutionRefs: ['EU-local-code-debug-enriched123-rerun'],
    },
  });

  assert.ok(payload);
  assert.match(payload.message, /enriched\.py/);
  assert.match(payload.message, /Based on the previous local code-debug result/);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.local-code-debug.pytest-repair');
});

test('local code debug follow-up hydrates prior artifact from inline agent harness contract refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-inline-harness-'));
  const artifactDir = join(workspace, '.sciforge', 'sessions', 'session-b', 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, 'local-code-debug-inline456.json'), JSON.stringify({
    id: 'local-code-debug-inline456',
    type: 'research-report',
    metadata: {
      source: 'sciforge.local-code-debug.pytest-repair',
      command: 'python -m pytest test_model.py -q',
      changedRefs: ['model.py'],
    },
    data: {
      markdown: [
        'Local code-debug runtime completed the requested bounded repair without remote backend generation.',
        '',
        'Patch summary:',
        '- model.py: reconciled the implementation with the local test contract.',
        '',
        '测试结果:',
        '- Initial: `python -m pytest test_model.py -q` -> failed (exit 1)',
        '- Rerun: `python -m pytest test_model.py -q` -> passed',
        '',
        'Remaining risks:',
        '- Additional model variants remain untested.',
      ].join('\n'),
    },
  }), 'utf8');

  const payload = await tryRunLocalCodeDebugRuntime({
    skillDomain: 'literature',
    prompt: 'Follow up from the previous local code debug result: summarize patch summary, pytest rerun, and remaining risks. Do not modify files or run tests.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {
      forceAgentServerGeneration: true,
      agentHarness: {
        contract: {
          contextRefs: {
            allowed: ['local-code-debug-inline456'],
          },
        },
      },
    },
  });

  assert.ok(payload);
  assert.match(payload.message, /model\.py/);
  assert.match(payload.message, /Rerun: `python -m pytest test_model\.py -q` -> passed/);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.local-code-debug.pytest-repair');
  assert.equal(payload.displayIntent?.taskOutcome, 'satisfied');
});

test('local code debug gateway payload projects as satisfied after failed initial test and passed rerun', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-code-debug-gateway-'));
  await writeFile(join(workspace, 'paper_metric_kernel.py'), [
    'import numpy as np',
    '',
    'def pairwise_sq_dists(x, y):',
    '    x = np.asarray(x, dtype=float)',
    '    y = np.asarray(y, dtype=float)',
    '    return ((x[:, None, :] - y[None, :, :]) ** 2).sum(axis=2)',
    '',
    'def inverse_multiquadric_kernel(x, y, c=1.0):',
    '    d2 = pairwise_sq_dists(x, y)',
    '    return 1.0 / (d2 + c ** 2)',
    '',
    'def mmd2_unbiased(x, y, c=1.0):',
    '    kxx = inverse_multiquadric_kernel(x, x, c)',
    '    kyy = inverse_multiquadric_kernel(y, y, c)',
    '    kxy = inverse_multiquadric_kernel(x, y, c)',
    '    n = x.shape[0]',
    '    m = y.shape[0]',
    '    return (kxx.sum() - np.trace(kxx)) / (n * (n - 1)) + (kyy.sum() - np.trace(kyy)) / (m * (m - 1)) - 2.0 * kxy.mean()',
    '',
  ].join('\n'));
  await writeFile(join(workspace, 'test_kernel_mmd.py'), [
    'import numpy as np',
    'from paper_metric_kernel import inverse_multiquadric_kernel, mmd2_unbiased',
    '',
    'def test_inverse_multiquadric_matches_paper_definition():',
    '    observed = inverse_multiquadric_kernel(np.array([[0.0], [3.0]]), np.array([[4.0]]), c=2.0).ravel()',
    '    np.testing.assert_allclose(observed, [1 / np.sqrt(20.0), 1 / np.sqrt(5.0)])',
    '',
    'def test_mmd2_is_near_zero_for_identical_samples():',
    '    x = np.array([[0.0], [1.0], [2.0], [3.0]])',
    '    assert abs(mmd2_unbiased(x, x, c=1.0)) < 1e-12',
    '',
  ].join('\n'));

  const payload = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Debug paper_metric_kernel.py: first run python -m pytest test_kernel_mmd.py -q, identify root cause, patch code, rerun tests, and report remaining risks.',
    workspacePath: workspace,
    artifacts: [],
    uiState: {},
  });
  const taskRunCard = payload.displayIntent?.taskRunCard as { taskOutcome?: string; status?: string } | undefined;
  const conversationProjection = payload.displayIntent?.conversationProjection as {
    visibleAnswer?: { status?: string; text?: string };
  } | undefined;
  const resultPresentation = payload.displayIntent?.resultPresentation as { status?: string } | undefined;

  assert.equal(taskRunCard?.taskOutcome, 'satisfied');
  assert.equal(taskRunCard?.status, 'complete');
  assert.equal(conversationProjection?.visibleAnswer?.status, 'satisfied');
  assert.doesNotMatch(conversationProjection?.visibleAnswer?.text ?? '', /Partial result artifacts|Draft result summary/);
  assert.equal(resultPresentation?.status, 'complete');
  assert.match(payload.message, /Initial: `python -m pytest test_kernel_mmd.py -q` -> failed/);
  assert.match(payload.message, /Rerun: `python -m pytest test_kernel_mmd.py -q` -> passed/);
});
