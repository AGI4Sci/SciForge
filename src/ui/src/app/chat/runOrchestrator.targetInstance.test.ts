import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { AgentStreamEvent, PeerInstance, SciForgeConfig, SciForgeSession } from '../../domain';
import { CODEX_RUNTIME_STREAM_PATH } from '../../api/sciforgeToolsClient';
import {
  TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE,
  TARGET_ISSUE_READ_EVENT_TYPE,
  TARGET_REPAIR_MODIFYING_EVENT_TYPE,
  TARGET_REPAIR_TESTING_EVENT_TYPE,
  TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE,
  TARGET_WORKTREE_PREPARING_EVENT_TYPE,
} from '@sciforge-ui/runtime-contract';
import {
  buildAnnotationWindowActionHandoff,
  runPreflightContextCompaction,
  runPromptOrchestrator,
  shouldBlockOnPreflightContextCompaction,
} from './runOrchestrator';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('runPromptOrchestrator target instance guard', () => {
  it('handles annotation-plan-only turnMode before target lookup, compaction, or runtime transport', async () => {
    const fetched: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetched.push(String(input));
      return jsonResponse({ ok: false, error: 'annotation plan-only must not fetch' }, 500);
    }) as typeof fetch;

    const events: AgentStreamEvent[] = [];
    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: '整理注释草稿',
      turnMode: 'annotation-plan-only',
      targetPeer: peer(),
      onStreamEvent: (event) => events.push(event),
    }));

    assert.equal(result.status, 'completed');
    assert.equal(fetched.length, 0);
    assert.match(result.finalResponse.message.content, /annotation-plan-only policy/);
    assert.equal(result.finalResponse.message.provenance?.runtimeRequestEligible, false);
    assert.equal(result.finalResponse.executionUnits.length, 0);
    assert.equal(events.some((event) => event.type.startsWith('target-')), false);
    assert.equal(events.some((event) => event.type === 'contextCompaction'), false);
    assert.equal(events.find((event) => event.type === 'annotation-plan-only')?.label, 'Annotation plan');
  });

  it('handles annotation-plan-only envelope before target lookup, compaction, or runtime transport', async () => {
    const fetched: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetched.push(String(input));
      return jsonResponse({ ok: false, error: 'annotation plan-only must not fetch' }, 500);
    }) as typeof fetch;

    const events: AgentStreamEvent[] = [];
    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: '整理注释草稿',
      conversationEnvelope: annotationEnvelope(),
      targetPeer: peer(),
      onStreamEvent: (event) => events.push(event),
    }));

    assert.equal(result.status, 'completed');
    assert.equal(fetched.length, 0);
    assert.equal(result.finalResponse.message.provenance?.runtimeRequestEligible, false);
    assert.equal(events.some((event) => event.type.startsWith('target-')), false);
    assert.equal(events.find((event) => event.type === 'annotation-plan-only')?.label, 'Annotation plan');
  });

  it('fails closed for malformed annotation-plan-only envelopes before runtime transport', async () => {
    const fetched: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetched.push(String(input));
      return jsonResponse({ ok: false, error: 'annotation plan-only must not fetch' }, 500);
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: '整理注释草稿',
      conversationEnvelope: {
        schemaVersion: 'sciforge.annotation-plan-only-envelope.v1',
        kind: 'annotation-plan-only',
      },
      targetPeer: peer(),
    }));

    assert.equal(result.status, 'failed');
    assert.match(result.message, /Malformed annotation-plan-only envelope/);
    assert.equal(fetched.length, 0);
  });

  it('forwards annotation quick-action lane metadata so runtime transport starts fresh', async () => {
    const runtimeRequests: Array<Record<string, unknown>> = [];
    const previousCodexSessionId = '019e4f00-1111-7000-9000-orchestrator';
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === `http://127.0.0.1:5174${CODEX_RUNTIME_STREAM_PATH}`) {
        runtimeRequests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return streamResponse([{
          result: {
            message: 'Annotation quick action ran on a fresh lane.',
            executionUnits: [{ id: 'unit-annotation-quick-action', status: 'done' }],
            artifacts: [],
          },
        }]);
      }
      return jsonResponse({ ok: false, error: `unexpected ${url}` }, 404);
    }) as typeof fetch;

    const session: SciForgeSession = {
      ...emptySession(),
      runs: [{
        id: 'run-selected-report',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'previous native run',
        response: 'previous answer',
        createdAt: '2026-05-19T00:00:00.000Z',
        completedAt: '2026-05-19T00:00:01.000Z',
        raw: { codexSessionId: previousCodexSessionId },
      }],
      artifacts: [{
        id: 'selected-report',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        dataRef: '.sciforge/artifacts/selected-report.md',
        metadata: { runId: 'run-selected-report' },
      }],
    };

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: 'Apply a small annotation tweak',
      baseSession: session,
      activeSession: () => session,
      references: [{
        id: 'ref-selected-report',
        kind: 'task-result',
        title: 'Selected report',
        ref: 'artifact:selected-report',
        runId: 'run-selected-report',
        payload: {
          currentReference: {
            id: 'selected-report',
            ref: 'artifact:selected-report',
            runId: 'run-selected-report',
            provenance: { dataRef: '.sciforge/artifacts/selected-report.md' },
          },
        },
      }],
      turnMode: 'annotation-quick-action',
      conversationLaneId: 'annotation:session-test:draft-quick:quick-action',
      runtimeResumePolicy: 'none',
      conversationEnvelope: {
        schemaVersion: 'sciforge.annotation-quick-action-envelope.v1',
        kind: 'annotation-quick-action',
        draftId: 'draft-quick',
      },
    }));

    assert.equal(result.status, 'completed');
    assert.equal(runtimeRequests.length, 1);
    assert.equal(runtimeRequests[0]?.codexSessionId, undefined);
    assert.equal((runtimeRequests[0]?.realtimeSession as Record<string, unknown>).resumeRequested, false);
    assert.doesNotMatch(String(runtimeRequests[0]?.commandText ?? ''), /^Continue the active Runtime Codex session\./);
    assert.equal('turnMode' in runtimeRequests[0], false);
    assert.equal('conversationEnvelope' in runtimeRequests[0], false);
    assert.equal('conversationLaneId' in runtimeRequests[0], false);
  });

  it('promotes only sanitized bound annotation quick-action refs into the WindowActionSession handoff projection', async () => {
    const runtimeRequests: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === `http://127.0.0.1:5174${CODEX_RUNTIME_STREAM_PATH}`) {
        runtimeRequests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return streamResponse([{
          result: {
            message: 'Annotation quick action received window action handoff.',
            executionUnits: [{ id: 'unit-window-action-handoff', status: 'done' }],
            artifacts: [],
          },
        }]);
      }
      return jsonResponse({ ok: false, error: `unexpected ${url}` }, 404);
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: 'Apply a small copy tweak to the selected desktop window',
      references: [
        desktopAnnotationRef('manual', {
          annotationRef: 'desktop-annotation:workspace/a/session/b/annotation/manual',
          imageRef: 'desktop-annotation:workspace/a/session/b/screenshot/manual',
          sourceKind: 'window-capture',
          windowBinding: {
            status: 'manual-bound',
            confidence: 1,
            reason: 'User picked the app window.',
            windowRef: 'desktop-window:app:paper-reader:window-42',
            appName: 'Paper Reader',
            bundleId: 'com.example.paper-reader',
            pid: 4242,
            title: 'Attention Is All You Need.pdf',
            windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
            windowLocalBounds: { x: 120, y: 160, width: 320, height: 240 },
            windowActionSessionRef: 'window-action-session:should-not-project',
            actionRef: 'window-action-ref:should-not-project',
            guiExecutable: true,
          },
          privateRoute: 'https://provider.example.test/private',
        }),
        desktopAnnotationRef('auto-high', {
          annotationRef: 'desktop-annotation:workspace/a/session/b/annotation/auto-high',
          screenshotRef: 'desktop-annotation:workspace/a/session/b/screenshot/auto-high',
          sourceKind: 'screen-region',
          windowBinding: {
            status: 'auto-bound',
            confidence: 0.94,
            reason: 'Selected region overlapped the active window.',
            windowRef: 'desktop-window:app:paper-reader:window-42',
            appName: 'Paper Reader',
            windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
            windowLocalBounds: { x: 140, y: 180, width: 240, height: 120 },
          },
        }),
        desktopAnnotationRef('auto-low', {
          imageRef: 'desktop-annotation:workspace/a/session/b/screenshot/auto-low',
          sourceKind: 'screen-region',
          windowBinding: {
            status: 'auto-bound',
            confidence: 0.61,
            reason: 'Below action threshold.',
            windowRef: 'desktop-window:app:paper-reader:window-low',
          },
        }),
        desktopAnnotationRef('blocked', {
          imageRef: 'desktop-annotation:workspace/a/session/b/screenshot/blocked',
          sourceKind: 'window-capture',
          windowBinding: {
            status: 'blocked',
            confidence: 1,
            reason: 'Capture permission blocked.',
            windowRef: 'desktop-window:should-not-promote',
          },
        }),
        desktopAnnotationRef('image-only', {
          imageRef: 'desktop-annotation:workspace/a/session/b/screenshot/image-only',
          sourceKind: 'annotation-crop',
        }),
      ],
      turnMode: 'annotation-quick-action',
      conversationEnvelope: {
        schemaVersion: 'sciforge.annotation-quick-action-envelope.v1',
        kind: 'annotation-quick-action',
        draftId: 'draft-window-action',
      },
      conversationLaneId: 'annotation:session-test:draft-window-action:quick-action',
      runtimeResumePolicy: 'none',
    }));

    assert.equal(result.status, 'completed');
    assert.equal(runtimeRequests.length, 1);
    const audit = runtimeRequests[0]?.auditMetadata as { guiLocalProjection?: { windowActionHandoff?: Record<string, unknown> } };
    const handoff = audit.guiLocalProjection?.windowActionHandoff as {
      schemaVersion?: string;
      intent?: string;
      mode?: string;
      actionFlowRef?: string;
      promotedRefs?: Array<Record<string, unknown>>;
    } | undefined;
    assert.equal(handoff?.schemaVersion, 'sciforge.window-action-handoff.v1');
    assert.equal(handoff?.intent, 'annotation-quick-action');
    assert.equal(handoff?.mode, 'enter-or-reuse-window-action-session');
    assert.match(String(handoff?.actionFlowRef ?? ''), /^window-action-flow:annotation:session-test:draft-window-action:quick-action/);
    assert.deepEqual(handoff?.promotedRefs?.map((ref) => ref.referenceId), ['ref-desktop-manual', 'ref-desktop-auto-high']);
    assert.deepEqual(handoff?.promotedRefs?.map((ref) => (ref.windowBinding as Record<string, unknown>).status), ['manual-bound', 'auto-bound']);
    assert.equal((handoff?.promotedRefs?.[1]?.windowBinding as Record<string, unknown>).confidence, 0.94);
    assert.doesNotMatch(JSON.stringify(handoff), /auto-low|blocked|image-only|should-not-promote|window-low/);
    assert.doesNotMatch(JSON.stringify(handoff), /window-action-session:should-not-project|window-action-ref:should-not-project|guiExecutable|privateRoute|provider\.example/);
  });

  it('builds bounded WindowActionSession handoff metadata from annotation quick-action refs', () => {
    const handoff = buildAnnotationWindowActionHandoff({
      references: [
        desktopAnnotationRef('manual', {
          annotationRef: 'desktop-annotation:workspace/a/session/b/annotation/manual',
          imageRef: 'desktop-annotation:workspace/a/session/b/screenshot/manual',
          sourceKind: 'window-capture',
          windowBinding: {
            status: 'manual-bound',
            confidence: 1,
            reason: 'User picked the app window.',
            windowRef: 'desktop-window:app:paper-reader:window-42',
            appName: 'Paper Reader',
            bundleId: 'com.example.paper-reader',
            pid: 4242,
            windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
            windowLocalBounds: { x: 120, y: 160, width: 320, height: 240 },
            guiExecutable: true,
          },
          privateRoute: 'https://provider.example.test/private',
        }),
        desktopAnnotationRef('auto-low', {
          imageRef: 'desktop-annotation:workspace/a/session/b/screenshot/auto-low',
          sourceKind: 'screen-region',
          windowBinding: {
            status: 'auto-bound',
            confidence: 0.61,
            windowRef: 'desktop-window:app:paper-reader:window-low',
          },
        }),
      ],
      turnMode: 'annotation-quick-action',
      conversationLaneId: 'annotation:session-test:draft-window-action:quick-action',
      currentTurnId: 'msg-current',
    });

    assert.equal(handoff?.schemaVersion, 'sciforge.window-action-handoff.v1');
    assert.equal(handoff?.promotedRefs.length, 1);
    assert.equal(handoff?.promotedRefs[0]?.referenceId, 'ref-desktop-manual');
    assert.equal(handoff?.promotedRefs[0]?.sourceKind, 'window-capture');
    assert.doesNotMatch(JSON.stringify(handoff), /auto-low|window-low|guiExecutable|privateRoute/);
  });

  it('does not dispatch AgentServer or repair current instance when target issue bundle lookup fails', async () => {
    const fetched: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      fetched.push(url);
      return jsonResponse({ ok: false, error: 'feedback issue not found: feedback-missing' }, 404);
    }) as typeof fetch;

    const events: AgentStreamEvent[] = [];
    const result = await runPromptOrchestrator({
      prompt: '修复 B 的 feedback #feedback-missing',
      baseSession: emptySession(),
      references: [],
      scenarioId: 'literature-evidence-review',
      baseScenarioId: 'literature-evidence-review',
      scenarioName: 'Literature',
      scenarioDomain: 'literature',
      role: 'researcher',
      config: testConfig(),
      targetPeer: peer(),
      availableComponentIds: [],
      defaultComponentIds: [],
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
      skillPlanRef: 'skill-plan.test',
      uiPlanRef: 'ui-plan.test',
      streamEvents: [],
      signal: new AbortController().signal,
      userAbortRequested: () => false,
      activeSession: emptySession,
      onStreamEvent: (event) => events.push(event),
    });

    assert.equal(result.status, 'failed');
    assert.match(result.message, /未启动修复，避免误改当前实例/);
    assert.deepEqual(fetched, ['http://127.0.0.1:6274/api/sciforge/feedback/issues/feedback-missing?workspacePath=%2Ftmp%2Ftarget-b']);
    assert.equal(events.some((event) => event.type === TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE), true);
    assert.equal(events[0]?.label, '目标 issue');
  });

  it('emits target issue repair handoff events through runtime contract projection', async () => {
    const runtimeRequests: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:6274/api/sciforge/feedback/issues/feedback-1')) {
        return jsonResponse({
          issue: {
            id: 'feedback-1',
            title: 'Broken report renderer',
            status: 'open',
            priority: 'high',
            comment: 'Renderer fails on report artifacts.',
          },
        });
      }
      if (url === `http://127.0.0.1:5174${CODEX_RUNTIME_STREAM_PATH}`) {
        runtimeRequests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return streamResponse([{
          result: {
            message: 'Repair completed.',
            executionUnits: [{ id: 'unit-1', status: 'done' }],
            artifacts: [],
          },
        }]);
      }
      return jsonResponse({ ok: false, error: `unexpected ${url}` }, 404);
    }) as typeof fetch;

    const events: AgentStreamEvent[] = [];
    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: '修复 B 的 feedback #feedback-1',
      targetPeer: peer(),
      onStreamEvent: (event) => events.push(event),
    }));

    assert.equal(result.status, 'completed', result.status === 'failed' ? result.message : undefined);
    assert.equal(runtimeRequests.length, 1);
    assert.equal(runtimeRequests[0]?.commandText, '修复 B 的 feedback #feedback-1');
    const runtimeAudit = runtimeRequests[0]?.auditMetadata as { guiLocalProjection?: { refs?: string[] } };
    assert.equal(runtimeAudit.guiLocalProjection?.refs?.includes('artifact:feedback-1'), false);
    assert.deepEqual(
      events
        .filter((event) => event.type.startsWith('target-'))
        .map((event) => event.type),
      [
        TARGET_ISSUE_READ_EVENT_TYPE,
        TARGET_WORKTREE_PREPARING_EVENT_TYPE,
        TARGET_REPAIR_MODIFYING_EVENT_TYPE,
        TARGET_REPAIR_TESTING_EVENT_TYPE,
        TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE,
      ],
    );
    assert.equal(events.find((event) => event.type === TARGET_ISSUE_READ_EVENT_TYPE)?.detail, '已从 Repair B 读取 issue bundle feedback-1。');
    assert.deepEqual(events.find((event) => event.type === TARGET_REPAIR_MODIFYING_EVENT_TYPE)?.raw, {
      targetInstance: {
        name: 'Repair B',
        appUrl: 'http://127.0.0.1:6273',
        workspaceWriterUrl: 'http://127.0.0.1:6274',
        workspacePath: '/tmp/target-b',
        role: 'repair',
        trustLevel: 'repair',
      },
      issueId: 'feedback-1',
      executionBoundary: 'repair-handoff-runner-target-worktree',
    });
  });

  it('does not block preflight context compaction when latency policy allows background compaction', async () => {
    let compactFetches = 0;
    globalThis.fetch = (async () => {
      compactFetches += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return jsonResponse({ data: { contextCompaction: { status: 'completed', source: 'agentserver' } } });
    }) as typeof fetch;
    const events: AgentStreamEvent[] = [
      event({
        type: 'conversation-policy',
        label: '策略',
        raw: {
          latencyPolicy: {
            schemaVersion: 'sciforge.conversation.latency-policy.v1',
            blockOnContextCompaction: false,
          },
        },
      }),
      event({
        type: 'contextWindowState',
        label: '上下文窗口',
        contextWindowState: {
          source: 'agentserver-estimate',
          usedTokens: 950,
          windowTokens: 1000,
          ratio: 0.95,
          status: 'near-limit',
          compactCapability: 'agentserver',
          autoCompactThreshold: 0.82,
        },
      }),
    ];
    const emitted: AgentStreamEvent[] = [];
    const started = Date.now();

    await runPreflightContextCompaction({
      baseSession: emptySession(),
      config: testConfig(),
      request: minimalAgentRequest(),
      streamEvents: events,
      signal: new AbortController().signal,
      onStreamEvent: (streamEvent) => emitted.push(streamEvent),
    });

    assert.equal(shouldBlockOnPreflightContextCompaction(events), false);
    assert.equal(compactFetches, 1);
    assert.ok(Date.now() - started < 25, 'preflight compaction should return before background compact fetch resolves');
    assert.match(emitted[0]?.detail ?? '', /Context compaction started in the background/);
  });

  it('dispatches report artifact follow-ups to the backend instead of resolving them in the UI', async () => {
    const session = sessionWithReportArtifact();
    const prompt = '给我markdown格式的报告，我需要看';
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return streamResponse([{
        result: {
          message: 'Backend rendered report follow-up.',
          executionUnits: [{
            id: 'unit-backend-followup',
            tool: 'capability.report.followup',
            params: '{}',
            status: 'done',
            hash: 'hash-backend-followup',
            artifacts: ['research-report'],
            outputArtifacts: ['research-report'],
          }],
          artifacts: [{
            id: 'research-report',
            type: 'research-report',
            schemaVersion: '1',
            data: { markdown: '# Backend Report' },
          }],
          uiManifest: [{
            componentId: 'report-viewer',
            artifactRef: 'research-report',
            priority: 1,
          }],
        },
      }]);
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt,
      baseSession: session,
      activeSession: () => session,
      references: [{
        id: 'ref-research-report',
        kind: 'task-result',
        title: 'research-report',
        ref: 'artifact:research-report',
        payload: { dataRef: '.sciforge/sessions/session-test/task-results/research-report.md' },
      }],
    }));

    assert.equal(result.status, 'completed');
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].commandText, `ask --ref ".sciforge/sessions/session-test/task-results/research-report.md" --ref "artifact:research-report" "${prompt}"`);
    assert.equal('prompt' in requestBodies[0], false);
    assert.equal('uiState' in requestBodies[0], false);
    assert.equal('artifacts' in requestBodies[0], false);
    const audit = requestBodies[0].auditMetadata as { guiLocalProjection?: { selectedRefCount?: number; refs?: string[] } };
    assert.equal(audit.guiLocalProjection?.selectedRefCount, 1);
    assert.equal(audit.guiLocalProjection?.refs?.includes('artifact:research-report'), true);
    assert.equal(result.finalResponse.message.content, 'Backend rendered report follow-up.');
    assert.equal(result.finalResponse.executionUnits[0]?.tool, 'capability.report.followup');
    assert.notEqual(result.finalResponse.executionUnits[0]?.tool, 'sciforge.existing-artifact-followup');
  });

  it('dispatches non-report artifact follow-ups to the backend with session artifact context', async () => {
    const session = sessionWithGenericArtifact();
    const prompt = '继续解释刚才 artifact 的异常点，并给出下一步处理建议';
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return streamResponse([{
        result: {
          message: 'Backend inspected artifact follow-up.',
          executionUnits: [{
            id: 'unit-artifact-followup',
            tool: 'capability.artifact.followup',
            params: '{}',
            status: 'done',
            hash: 'hash-artifact-followup',
            artifacts: ['volcano-plot'],
            outputArtifacts: ['volcano-plot'],
          }],
          artifacts: [{
            id: 'volcano-plot',
            type: 'figure',
            schemaVersion: '1',
            data: { points: [{ gene: 'TP53', logfc: 2.4, p: 0.001 }] },
          }],
          uiManifest: [{
            componentId: 'generic-artifact-inspector',
            artifactRef: 'volcano-plot',
            priority: 1,
          }],
        },
      }]);
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt,
      baseSession: session,
      activeSession: () => session,
      references: [{
        id: 'ref-volcano-plot',
        kind: 'task-result',
        title: 'volcano-plot',
        ref: 'artifact:volcano-plot',
        payload: { dataRef: '.sciforge/sessions/session-test/task-results/volcano-plot.json' },
      }],
    }));

    assert.equal(result.status, 'completed');
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].commandText, `ask --ref ".sciforge/sessions/session-test/task-results/volcano-plot.json" --ref "artifact:volcano-plot" "${prompt}"`);
    assert.equal('prompt' in requestBodies[0], false);
    assert.equal('uiState' in requestBodies[0], false);
    assert.equal('artifacts' in requestBodies[0], false);
    const audit = requestBodies[0].auditMetadata as { guiLocalProjection?: { selectedRefCount?: number; refs?: string[] } };
    assert.equal(audit.guiLocalProjection?.selectedRefCount, 1);
    assert.equal(audit.guiLocalProjection?.refs?.includes('artifact:volcano-plot'), true);
    assert.equal(result.finalResponse.message.content, 'Backend inspected artifact follow-up.');
    assert.equal(result.finalResponse.executionUnits[0]?.tool, 'capability.artifact.followup');
    assert.notEqual(result.finalResponse.executionUnits[0]?.tool, 'sciforge.existing-artifact-followup');
  });

  it('dispatches failed-run repair follow-ups to backend recovery policy instead of UI self-heal fallback', async () => {
    const session = sessionWithFailedRun();
    const prompt = '修复上一轮失败并继续';
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return streamResponse([{
        result: {
          message: 'Backend repaired the failed run.',
          executionUnits: [{
            id: 'unit-failure-repair',
            tool: 'capability.failure.repair',
            params: '{}',
            status: 'done',
            hash: 'hash-failure-repair',
            recoverActions: ['reran schema-valid artifact generation'],
          }],
          artifacts: [{
            id: 'repaired-output',
            type: 'repair-summary',
            schemaVersion: '1',
            data: { status: 'repaired' },
          }],
        },
      }]);
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt,
      baseSession: session,
      activeSession: () => session,
    }));

    assert.equal(result.status, 'completed');
    assert.equal(requestBodies.length, 1);
    assert.match(String(requestBodies[0].commandText), /^Same-chat continuity context for relative references\./);
    assert.match(String(requestBodies[0].commandText), new RegExp(`Current request:\\n\\n${prompt}$`));
    assert.equal('prompt' in requestBodies[0], false);
    assert.equal('uiState' in requestBodies[0], false);
    assert.equal('failureRecoveryPolicy' in requestBodies[0], false);
    const audit = requestBodies[0].auditMetadata as { guiLocalProjection?: { refs?: string[]; counts?: { runRefs?: number; executionUnitRefs?: number } } };
    assert.equal(audit.guiLocalProjection?.refs?.includes('run:run-failed-report'), true);
    assert.equal(audit.guiLocalProjection?.refs?.includes('execution-unit:unit-failed-report'), true);
    assert.equal(audit.guiLocalProjection?.counts?.runRefs, 1);
    assert.equal(audit.guiLocalProjection?.counts?.executionUnitRefs, 1);
    assert.equal(result.finalResponse.message.content, 'Backend repaired the failed run.');
    assert.equal(result.finalResponse.executionUnits[0]?.tool, 'capability.failure.repair');
    assert.equal(result.finalResponse.executionUnits.some((unit) => unit.status === 'self-healed'), false);
  });

  it('fails interrupted report follow-ups instead of synthesizing existing-artifact answers', async () => {
    const session = sessionWithReportArtifact();
    globalThis.fetch = (async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: '帮我重新检索过去一周 arxiv 上 AI Agent 相关论文',
      baseSession: session,
      activeSession: () => session,
    }));

    assert.equal(result.status, 'failed');
    assert.match(result.message, /The current task was interrupted by the system or network/);
    assert.equal(result.failedSession.runs[0]?.status, 'failed');
    assert.equal((result.failedSession.runs[0]?.raw as { termination?: { reason?: string; sessionStatus?: string } }).termination?.reason, 'system-aborted');
    assert.equal((result.failedSession.runs[0]?.raw as { termination?: { reason?: string; sessionStatus?: string } }).termination?.sessionStatus, 'failed');
    assert.doesNotMatch(result.failedSession.runs[0]?.response ?? '', /^# AgentServer Report/);
    assert.equal(result.failedSession.executionUnits.some((unit) => unit.status === 'self-healed'), false);
  });

  it('does not synthesize interrupted follow-ups in the UI transport layer', async () => {
    const session = sessionWithReportArtifact();
    globalThis.fetch = (async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: 'Please rerun the search and download the latest papers',
      baseSession: session,
      activeSession: () => session,
    }));

    assert.equal(result.status, 'failed');
    assert.match(result.message, /The current task was interrupted by the system or network/);
    assert.equal(result.failedSession.executionUnits.some((unit) => unit.status === 'self-healed'), false);
  });
});

function emptySession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-test',
    scenarioId: 'literature-evidence-review',
    title: 'Test',
    createdAt: '2026-05-07T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

function sessionWithGenericArtifact(): SciForgeSession {
  return {
    ...emptySession(),
    artifacts: [{
      id: 'volcano-plot',
      type: 'figure',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Volcano plot' },
      data: {
        points: [
          { gene: 'TP53', logfc: 2.4, p: 0.001 },
          { gene: 'EGFR', logfc: -1.2, p: 0.04 },
        ],
      },
    }],
    uiManifest: [{
      componentId: 'generic-artifact-inspector',
      artifactRef: 'volcano-plot',
      priority: 1,
    }],
  };
}

function sessionWithReportArtifact(overrides: Partial<SciForgeSession> = {}): SciForgeSession {
  return {
    ...emptySession(),
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'AgentServer Report' },
      data: {
        markdown: '# AgentServer Report\n\nFound 50 AI Agent papers from the past week on arxiv.',
      },
    }],
    uiManifest: [{
      componentId: 'report-viewer',
      artifactRef: 'research-report',
      priority: 1,
    }],
    ...overrides,
  };
}

function sessionWithFailedRun(): SciForgeSession {
  return {
    ...emptySession(),
    messages: [{
      id: 'msg-failed-user',
      role: 'user',
      content: 'materialize report',
      createdAt: '2026-05-07T00:00:00.000Z',
      status: 'completed',
    }, {
      id: 'msg-failed-scenario',
      role: 'scenario',
      content: 'schema validation failed for research-report',
      createdAt: '2026-05-07T00:01:00.000Z',
      status: 'failed',
    }],
    runs: [{
      id: 'run-failed-report',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'materialize report',
      response: 'schema validation failed for research-report',
      createdAt: '2026-05-07T00:00:00.000Z',
      completedAt: '2026-05-07T00:01:00.000Z',
      raw: {
        streamProcess: {
          summary: 'artifact materialization failed; backend requested repair.',
        },
      },
    }],
    executionUnits: [{
      id: 'unit-failed-report',
      tool: 'capability.report.generate',
      params: '{}',
      status: 'failed-with-reason',
      hash: 'hash-failed-report',
      failureReason: 'schema validation failed for research-report',
      recoverActions: ['Regenerate the report artifact with schemaVersion=1.'],
      nextStep: 'Retry artifact materialization before presenting success.',
      outputRef: '.sciforge/task-results/run-failed-report.json',
    }],
  };
}

function peer(): PeerInstance {
  return {
    name: 'Repair B',
    appUrl: 'http://127.0.0.1:6273',
    workspaceWriterUrl: 'http://127.0.0.1:6274',
    workspacePath: '/tmp/target-b',
    role: 'repair',
    trustLevel: 'repair',
    enabled: true,
  };
}

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
    workspacePath: '/tmp/current',
    agentBackend: 'codex',
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    requestTimeoutMs: 1000,
    maxContextWindowTokens: 200000,
    visionAllowSharedSystemInput: true,
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(items: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const item of items) {
        controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
      }
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

function event(partial: Partial<AgentStreamEvent>): AgentStreamEvent {
  return {
    id: partial.id ?? `evt-${partial.type ?? 'test'}`,
    type: partial.type ?? 'event',
    label: partial.label ?? partial.type ?? 'event',
    createdAt: partial.createdAt ?? '2026-05-07T00:00:00.000Z',
    ...partial,
  };
}

function desktopAnnotationRef(id: string, payload: Record<string, unknown>) {
  return {
    id: `ref-desktop-${id}`,
    kind: 'ui' as const,
    title: `Desktop ${id}`,
    ref: `desktop-annotation:annotation/${id}`,
    payload: {
      source: 'desktop-global-annotation',
      ...payload,
    },
  };
}

function orchestratorInput(overrides: Partial<Parameters<typeof runPromptOrchestrator>[0]> = {}): Parameters<typeof runPromptOrchestrator>[0] {
  const baseSession = overrides.baseSession ?? emptySession();
  return {
    prompt: 'test',
    baseSession,
    references: [],
    scenarioId: 'literature-evidence-review',
    baseScenarioId: 'literature-evidence-review',
    scenarioName: 'Literature',
    scenarioDomain: 'literature',
    role: 'researcher',
    config: testConfig(),
    availableComponentIds: [],
    defaultComponentIds: [],
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan.test',
    uiPlanRef: 'ui-plan.test',
    streamEvents: [],
    signal: new AbortController().signal,
    userAbortRequested: () => false,
    activeSession: () => baseSession,
    onStreamEvent: () => undefined,
    ...overrides,
  };
}

function annotationEnvelope(): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.annotation-plan-only-envelope.v1',
    kind: 'annotation-plan-only',
    draftId: 'annotation-plan-test',
    source: 'annotation-plan',
    page: 'workbench',
    scenarioId: 'literature-evidence-review',
    sessionId: 'session-test',
    currentUrl: 'http://127.0.0.1:5173/',
    references: [],
    allowedOutputs: ['clarifying-question', 'plan-summary', 'feedback-draft', 'acceptance-criteria'],
    forbiddenSideEffects: ['workspace-write', 'repair-start', 'runtime-execution', 'github-sync', 'code-change'],
    repairStartAllowed: false,
    runtimeExecutionAllowed: false,
    githubSyncAllowed: false,
    workspaceWriteAllowed: false,
  };
}

function minimalAgentRequest(): Parameters<typeof runPreflightContextCompaction>[0]['request'] {
  return {
    sessionId: 'session-test',
    scenarioId: 'literature-evidence-review',
    agentName: 'Literature',
    agentDomain: 'literature',
    prompt: 'test',
    references: [],
    roleView: 'researcher',
    messages: [],
    artifacts: [],
    executionUnits: [],
    runs: [],
    config: testConfig(),
    availableComponentIds: [],
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan.test',
    uiPlanRef: 'ui-plan.test',
  };
}
