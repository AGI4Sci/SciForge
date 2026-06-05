import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSidebarCommandPaletteMatches } from './sidebarCommandPaletteModel';

test('command palette discovers public child agent background and resume candidates', () => {
  const matches = buildSidebarCommandPaletteMatches('worker', {
    agentCandidates: [{
      projectId: 'project-main',
      sessionId: 'parent-thread',
      scenarioId: 'literature-evidence-review',
      threadState: 'running',
      candidate: {
        id: 'subagent-public',
        kind: 'subagent-result',
        label: 'Worker literature summary',
        detail: 'Summarized public refs · Refs: artifact:summary-public',
        refs: ['subagent:worker-summary'],
        status: 'active',
      },
    }, {
      projectId: 'project-main',
      sessionId: 'parent-thread',
      scenarioId: 'literature-evidence-review',
      threadState: 'running',
      candidate: {
        id: 'background-public',
        kind: 'background-task',
        label: 'Worker background validation',
        detail: 'Refs: run:worker-background',
        refs: ['run:worker-background'],
        status: 'background',
      },
    }, {
      projectId: 'project-main',
      sessionId: 'parent-thread',
      scenarioId: 'literature-evidence-review',
      threadState: 'running',
      candidate: {
        id: 'resume-public',
        kind: 'resume-candidate',
        label: 'Worker resume checkpoint',
        detail: 'Continue from checkpoint refs',
        refs: ['checkpoint:worker-resume'],
        status: 'resume',
      },
    }, {
      projectId: 'project-main',
      sessionId: 'parent-thread',
      scenarioId: 'literature-evidence-review',
      threadState: 'running',
      candidate: {
        id: 'unsafe-private',
        kind: 'background-task',
        label: 'provider token raw stdout /Applications/private/trace.jsonl',
        detail: 'secret runtime payload',
        refs: ['run:unsafe-private'],
        status: 'background',
      },
    }],
  });

  assert.deepEqual(matches.filter((match) => match.kind === 'agent-result').map((match) => ({
    label: match.label,
    candidateKind: match.candidateKind,
    projectId: match.projectId,
    sessionId: match.sessionId,
    candidateRef: match.candidateRef,
  })), [{
    label: 'Worker literature summary',
    candidateKind: 'subagent-result',
    projectId: 'project-main',
    sessionId: 'parent-thread',
    candidateRef: 'subagent:worker-summary',
  }, {
    label: 'Worker background validation',
    candidateKind: 'background-task',
    projectId: 'project-main',
    sessionId: 'parent-thread',
    candidateRef: 'run:worker-background',
  }, {
    label: 'Worker resume checkpoint',
    candidateKind: 'resume-candidate',
    projectId: 'project-main',
    sessionId: 'parent-thread',
    candidateRef: 'checkpoint:worker-resume',
  }]);
  assert.doesNotMatch(JSON.stringify(matches), /provider|token|stdout|stderr|raw|secret|\/Applications|trace\.jsonl/i);
});
