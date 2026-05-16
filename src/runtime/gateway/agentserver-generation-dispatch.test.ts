import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import { requestUsesRepairContext } from './agentserver-generation-dispatch.js';

test('fresh repair-or-continue execution mode does not imply repair continuation without a repair target', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '请用最小检索验证 arXiv 记录并输出证据摘要。',
    artifacts: [],
    uiState: {
      sessionId: 'fresh-literature-evidence-review',
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'new-task' },
        contextPolicy: { mode: 'isolate' },
        executionModePlan: {
          executionMode: 'repair-or-continue-project',
          signals: ['research', 'artifact-output', 'long-or-uncertain'],
        },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), false);
});

test('repair context requires a concrete failed run or execution ref', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '修复上一轮失败并继续。',
    artifacts: [],
    uiState: {
      sessionId: 'repair-without-target',
      contextReusePolicy: { mode: 'repair', historyReuse: { allowed: true } },
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'repair' },
        executionModePlan: {
          executionMode: 'repair-or-continue-project',
          signals: ['repair'],
        },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), false);
});

test('stale failed execution refs do not authorize repair from policy keywords alone', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '请复用失败诊断继续，修正生成任务并完成中文证据摘要。',
    artifacts: [],
    uiState: {
      sessionId: 'repair-keywords-with-stale-target',
      recentExecutionRefs: [{
        id: 'EU-stale-failed',
        status: 'failed-with-reason',
        stderrRef: '.sciforge/task-results/stale.stderr.txt',
        outputRef: '.sciforge/task-results/stale.json',
        failureReason: 'stale failure from an older projection',
      }],
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'repair' },
        executionModePlan: {
          executionMode: 'repair-or-continue-project',
          signals: ['repair'],
        },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), false);
});

test('failed current projection refs still authorize repair continuation', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '请复用失败诊断继续，修正生成任务并完成中文证据摘要。',
    artifacts: [],
    uiState: {
      sessionId: 'repair-with-target',
      contextReusePolicy: {
        mode: 'repair',
        historyReuse: { allowed: true },
        priorWorkSignals: { repairTargetAvailable: true },
      },
      recentExecutionRefs: [{
        id: 'EU-failed',
        status: 'failed-with-reason',
        stderrRef: '.sciforge/task-results/failed.stderr.txt',
        outputRef: '.sciforge/task-results/failed.json',
        failureReason: 'prior bounded stop',
      }],
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'repair' },
        executionModePlan: {
          executionMode: 'repair-or-continue-project',
          signals: ['repair'],
        },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), true);
});

test('structured recover action reference authorizes repair continuation without policy text signals', () => {
  const request = {
    skillDomain: 'literature',
    prompt: 'continue from the available action',
    artifacts: [],
    references: [{
      ref: 'recover-action:retry-provider',
      kind: 'recover-action',
      source: 'recover-action',
    }],
    uiState: {
      sessionId: 'repair-with-recover-action',
      recentExecutionRefs: [{
        id: 'EU-failed',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/failed.json',
        failureReason: 'schema validation failed',
      }],
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'continue' },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), true);
});
