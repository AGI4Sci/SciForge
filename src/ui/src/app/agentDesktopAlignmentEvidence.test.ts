import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AGENT_DESKTOP_ALIGNMENT_LIVE_LOOP,
  AGENT_DESKTOP_ALIGNMENT_LIVE_LEDGER_SCHEMA_VERSION,
  AGENT_DESKTOP_ALIGNMENT_REQUIREMENTS,
  createAgentDesktopAlignmentEvidenceRecord,
  createAgentDesktopAlignmentLiveLedger,
  sanitizeAlignmentEvidenceText,
  type AgentDesktopAlignmentDifferenceInput,
  type AgentDesktopAlignmentEvidenceInput,
  type AgentDesktopAlignmentLiveLedgerInput,
  type AgentDesktopAlignmentLiveLoopStepInput,
  type AgentDesktopAlignmentRequirementId,
} from './agentDesktopAlignmentEvidence';

const allRequirementIds = AGENT_DESKTOP_ALIGNMENT_REQUIREMENTS.map((requirement) => requirement.id);

test('agent desktop alignment evidence passes only when every requirement has SciForge Browser and Cursor Computer Use refs', () => {
  const record = createAgentDesktopAlignmentEvidenceRecord({
    recordId: 'alignment:pr-42',
    recordedAt: '2026-05-30T00:00:00.000Z',
    change: {
      kind: 'pull-request',
      summary: 'Align sidebar, chat process rows, and result presentation.',
      refs: ['pr:42'],
      surfaces: ['sidebar', 'chat', 'presentation'],
    },
    evidence: [
      sciforgeEvidence('sciforge-all', allRequirementIds, ['evidence:sciforge-browser-run']),
      cursorEvidence('cursor-all', allRequirementIds, ['evidence:cursor-computer-use-run']),
    ],
  });

  assert.equal(record.validation.ok, true);
  assert.equal(record.coverageMatrix.length, AGENT_DESKTOP_ALIGNMENT_REQUIREMENTS.length);
  assert.deepEqual(record.coverageMatrix.map((row) => row.status), Array(AGENT_DESKTOP_ALIGNMENT_REQUIREMENTS.length).fill('covered'));
  assert.ok(record.coverageMatrix.every((row) => row.sciforgeBrowserRefs.length > 0));
  assert.ok(record.coverageMatrix.every((row) => row.cursorAgentComputerUseRefs.length > 0));
});

test('agent desktop alignment evidence fails and points to gaps when Cursor side is missing', () => {
  const record = createAgentDesktopAlignmentEvidenceRecord({
    recordId: 'alignment:repair-run-missing-cursor',
    change: {
      kind: 'repair-run',
      summary: 'Repair chat action expansion.',
      refs: ['repair-run:chat-expansion'],
      surfaces: ['chat'],
    },
    evidence: [
      sciforgeEvidence('sciforge-command-only', ['command-expansion'], ['evidence:sciforge-command']),
    ],
  });

  const commandRow = record.coverageMatrix.find((row) => row.requirementId === 'command-expansion');
  const sidebarRow = record.coverageMatrix.find((row) => row.requirementId === 'sidebar-new-project-new-chat');

  assert.equal(record.validation.ok, false);
  assert.equal(commandRow?.status, 'missing-cursor-agent-computer-use');
  assert.deepEqual(commandRow?.missingSides, ['cursor-agent-computer-use']);
  assert.equal(sidebarRow?.status, 'missing-both');
  assert.ok(record.validation.diagnostics.some((diagnostic) => diagnostic.includes('Command action expands')));
  assert.ok(record.validation.missingRequirementIds.includes('command-expansion'));
});

test('agent desktop alignment evidence fails and points to gaps when SciForge side is missing', () => {
  const record = createAgentDesktopAlignmentEvidenceRecord({
    recordId: 'alignment:repair-run-missing-sciforge',
    change: {
      kind: 'repair-run',
      summary: 'Repair file preview.',
      refs: ['repair-run:file-preview'],
      surfaces: ['presentation'],
    },
    evidence: [
      cursorEvidence('cursor-file-preview', ['file-preview'], ['evidence:cursor-file-preview']),
    ],
  });

  const filePreviewRow = record.coverageMatrix.find((row) => row.requirementId === 'file-preview');

  assert.equal(record.validation.ok, false);
  assert.equal(filePreviewRow?.status, 'missing-sciforge-browser');
  assert.deepEqual(filePreviewRow?.missingSides, ['sciforge-browser']);
  assert.ok(record.validation.missingRequirementIds.includes('file-preview'));
});

test('agent desktop alignment evidence redacts provider secrets, model names, urls, and local paths from accepted summaries and details', () => {
  const record = createAgentDesktopAlignmentEvidenceRecord({
    recordId: 'alignment:redaction',
    change: {
      kind: 'pull-request',
      summary: 'Validated against provider=https://provider.example/private model=private-model-name.',
      refs: ['pr:redaction'],
    },
    evidence: [
      sciforgeEvidence('sciforge-redacted', allRequirementIds, ['evidence:sciforge-redacted'], {
        summary: 'Browser evidence saw Authorization: Bearer secret-token-123456 at https://provider.example/v1?api_key=abc123 and /Users/alice/private.txt modelName=private-model-name.',
        details: {
          providerUrl: 'https://provider.example/v1?token=abc123',
          authorization: 'Bearer secret-token-123456',
          safeNote: 'Diff was expanded with token=secret-token-123456 but bounded by evidence refs.',
        },
      }),
      cursorEvidence('cursor-redacted', allRequirementIds, ['evidence:cursor-redacted']),
    ],
  });

  const serialized = JSON.stringify(record);

  assert.equal(record.validation.ok, true);
  assert.doesNotMatch(serialized, /provider\.example|secret-token|abc123|private-model-name|\/Users\/alice/);
  assert.match(serialized, /\[redacted/);
  assert.equal(record.evidence[0]?.status, 'accepted');
});

test('agent desktop alignment evidence refuses full private dialogs and inline raw transcript payloads', () => {
  const record = createAgentDesktopAlignmentEvidenceRecord({
    recordId: 'alignment:privacy-refusal',
    change: {
      kind: 'repair-run',
      summary: 'Attempted invalid evidence upload.',
      refs: ['repair-run:privacy-refusal'],
    },
    evidence: [
      sciforgeEvidence('sciforge-private-dialog', ['running-state-live-updates'], ['evidence:sciforge-private'], {
        summary: 'Full private conversation pasted from the desktop.',
        privacyScope: 'full-private-dialog',
        details: {
          rawTranscript: 'user private line\nassistant private line\napi_key=should-not-leak',
        },
      }),
      cursorEvidence('cursor-live-update', ['running-state-live-updates'], ['evidence:cursor-live-update']),
    ],
  });

  const serialized = JSON.stringify(record);

  assert.equal(record.validation.ok, false);
  assert.deepEqual(record.validation.rejectedEvidenceIds, ['sciforge-private-dialog']);
  assert.equal(record.evidence[0]?.status, 'rejected');
  assert.match(record.evidence[0]?.summary ?? '', /Rejected evidence omitted/);
  assert.doesNotMatch(serialized, /user private line|assistant private line|should-not-leak/);
  assert.ok(record.validation.diagnostics.some((diagnostic) => diagnostic.includes('full-private-dialog')));
  assert.ok(record.validation.diagnostics.some((diagnostic) => diagnostic.includes('rawTranscript')));
});

test('sanitizeAlignmentEvidenceText clips and redacts standalone evidence notes', () => {
  const note = sanitizeAlignmentEvidenceText(
    `Open https://provider.example/v1 with api_key=abc123 and Authorization: Bearer live-token-1234567890 from /Applications/workspace/private ${'x'.repeat(700)}`,
    160,
  );

  assert.ok(note.length <= 175);
  assert.doesNotMatch(note, /provider\.example|abc123|live-token|\/Applications\/workspace/);
  assert.match(note, /\[redacted/);
});

test('live alignment ledger accepts a complete round only with both live sides, loop steps, closed differences, and retest refs', () => {
  const ledger = createAgentDesktopAlignmentLiveLedger({
    ledgerId: 'live-ledger:complete-round',
    recordedAt: '2026-05-30T02:00:00.000Z',
    status: 'complete',
    rounds: [
      {
        roundId: 'round-01',
        status: 'passed',
        startedAt: '2026-05-30T01:55:00.000Z',
        completedAt: '2026-05-30T02:00:00.000Z',
        observationEntryPoints: [
          {
            side: 'sciforge-browser',
            entryPoint: 'http://localhost:5174 left sidebar, chat flow, and result surface',
            refs: ['browser:round-01-sciforge'],
          },
          {
            side: 'cursor-agent-computer-use',
            entryPoint: 'Cursor Agent desktop app read-only project and process baseline',
            refs: ['computer-use:round-01-cursor'],
          },
        ],
        coverage: {
          surfaces: ['sidebar', 'chat', 'presentation'],
          requirementIds: allRequirementIds,
          summary: 'Round covered sidebar creation entries, process folding, action details, file previews, and result presentation.',
        },
        steps: completedLiveLoopSteps(),
        evidence: [
          sciforgeEvidence('sciforge-round-01', allRequirementIds, [
            'docs/agent-desktop-alignment-evidence/live-2026-05-30/round-01-sciforge-screenshot.png',
            'docs/agent-desktop-alignment-evidence/live-2026-05-30/round-01-sciforge-dom-snapshot.txt',
          ]),
          cursorEvidence('cursor-round-01', allRequirementIds, ['computer-use:round-01-cursor-a11y']),
        ],
        differences: [
          closedDifference('diff:command-expansion', ['command-expansion']),
        ],
        correctionDecision: {
          status: 'implemented',
          summary: 'Closed through generic process presentation schema, not a workspace-specific patch.',
          refs: ['src/ui/src/app/agentDesktopAlignmentEvidence.ts'],
        },
        verification: {
          status: 'passed',
          summary: 'Focused evidence ledger tests passed.',
          refs: ['src/ui/src/app/agentDesktopAlignmentEvidence.test.ts'],
        },
        redactionCheck: {
          status: 'passed',
          summary: 'Provider URL https://provider.example/v1, model name private-model, and /Users/alice/private are redacted.',
          refs: ['src/ui/src/app/agentDesktopAlignmentEvidence.test.ts'],
        },
      },
    ],
  });

  const serialized = JSON.stringify(ledger);

  assert.equal(ledger.validation.ok, true);
  assert.equal(ledger.policy.continuousLiveEvidence, true);
  assert.deepEqual(ledger.validation.openDifferenceIds, []);
  assert.deepEqual(ledger.validation.missingLiveEvidence, []);
  assert.doesNotMatch(serialized, /provider\.example|private-model|\/Users\/alice/);
  assert.match(serialized, /\[redacted/);
});

test('live alignment ledger keeps an active round open when Cursor Computer Use evidence is missing', () => {
  const ledger = createAgentDesktopAlignmentLiveLedger({
    ledgerId: 'live-ledger:missing-cursor',
    status: 'active',
    rounds: [
      {
        roundId: 'round-01',
        status: 'observed',
        observationEntryPoints: [
          {
            side: 'sciforge-browser',
            entryPoint: 'SciForge Browser app shell observation',
            refs: ['browser:round-01-sciforge'],
          },
        ],
        coverage: {
          surfaces: ['sidebar', 'chat', 'presentation'],
          requirementIds: ['sidebar-new-project-new-chat', 'right-side-result-presentation'],
          summary: 'SciForge side captured; Cursor side still requires live Computer Use refs.',
        },
        steps: [
          { id: 'observe-sciforge', status: 'completed', refs: ['browser:round-01-sciforge'] },
          { id: 'observe-cursor-agent', status: 'pending' },
          { id: 'record-differences', status: 'pending' },
          { id: 'update-project-todo', status: 'pending' },
          { id: 'implement-generic-fix', status: 'pending' },
          { id: 'verify', status: 'pending' },
          { id: 'retest-both-sides', status: 'pending' },
        ],
        evidence: [
          sciforgeEvidence('sciforge-round-01-only', ['sidebar-new-project-new-chat', 'right-side-result-presentation'], [
            'docs/agent-desktop-alignment-evidence/live-2026-05-30/round-01-sciforge-screenshot.png',
          ]),
        ],
        differences: [
          {
            ...openDifference('diff:needs-cursor-live-baseline', ['right-side-result-presentation']),
            evidenceRefs: ['browser:round-01-sciforge'],
            testRefs: ['src/ui/src/app/agentDesktopAlignmentEvidence.test.ts'],
            projectTodoRef: 'PROJECT.md',
          },
        ],
        correctionDecision: {
          status: 'planned',
          summary: 'No final correction decision until Cursor Agent Computer Use evidence is captured.',
          refs: ['PROJECT.md'],
        },
        verification: {
          status: 'not-run',
          summary: 'Waiting for live dual-side evidence.',
          refs: ['PROJECT.md'],
        },
        redactionCheck: {
          status: 'passed',
          summary: 'Only refs and bounded summaries are stored.',
          refs: ['src/ui/src/app/agentDesktopAlignmentEvidence.test.ts'],
        },
      },
    ],
  });

  assert.equal(ledger.validation.ok, false);
  assert.deepEqual(ledger.validation.missingLiveEvidence, [
    {
      roundId: 'round-01',
      side: 'cursor-agent-computer-use',
      requirementIds: ['sidebar-new-project-new-chat', 'right-side-result-presentation'],
    },
  ]);
  assert.deepEqual(ledger.validation.openDifferenceIds, ['diff:needs-cursor-live-baseline']);
  assert.ok(ledger.validation.diagnostics.some((diagnostic) => diagnostic.includes('missing accepted cursor-agent-computer-use live evidence')));
});

test('live alignment ledger checks dual-side refs per covered requirement, not just per round', () => {
  const ledger = createAgentDesktopAlignmentLiveLedger({
    ledgerId: 'live-ledger:partial-cursor-coverage',
    status: 'active',
    rounds: [
      {
        roundId: 'round-01',
        status: 'observed',
        observationEntryPoints: [
          { side: 'sciforge-browser', entryPoint: 'SciForge Browser', refs: ['browser:round-01-sciforge'] },
          { side: 'cursor-agent-computer-use', entryPoint: 'Cursor Agent desktop', refs: ['computer-use:round-01-cursor'] },
        ],
        coverage: {
          surfaces: ['sidebar', 'chat'],
          requirementIds: ['sidebar-new-project-new-chat', 'command-expansion', 'edit-diff-expansion'],
          summary: 'Cursor side observed sidebar only; command and diff interactions still need live refs.',
        },
        steps: [
          { id: 'observe-sciforge', status: 'completed', refs: ['browser:round-01-sciforge'] },
          { id: 'observe-cursor-agent', status: 'completed', refs: ['computer-use:round-01-cursor'] },
          { id: 'record-differences', status: 'completed', refs: ['PROJECT.md'] },
          { id: 'update-project-todo', status: 'completed', refs: ['PROJECT.md'] },
          { id: 'implement-generic-fix', status: 'pending' },
          { id: 'verify', status: 'pending' },
          { id: 'retest-both-sides', status: 'pending' },
        ],
        evidence: [
          sciforgeEvidence('sciforge-all-three', ['sidebar-new-project-new-chat', 'command-expansion', 'edit-diff-expansion'], [
            'browser:round-01-sciforge-all',
          ]),
          cursorEvidence('cursor-sidebar-only', ['sidebar-new-project-new-chat'], ['computer-use:round-01-cursor-sidebar']),
        ],
        differences: [
          {
            ...openDifference('diff:missing-interactive-cursor-coverage', ['command-expansion', 'edit-diff-expansion']),
            category: 'chat-process',
            surface: 'chat',
            evidenceRefs: ['browser:round-01-sciforge-all', 'computer-use:round-01-cursor-sidebar'],
          },
        ],
        correctionDecision: {
          status: 'planned',
          summary: 'Interactive Cursor refs must be captured before this round can pass.',
          refs: ['PROJECT.md'],
        },
        verification: {
          status: 'not-run',
          summary: 'Waiting for missing interactive live refs.',
          refs: ['PROJECT.md'],
        },
        redactionCheck: {
          status: 'passed',
          summary: 'Only refs and bounded summaries are stored.',
          refs: ['src/ui/src/app/agentDesktopAlignmentEvidence.test.ts'],
        },
      },
    ],
  });

  assert.equal(ledger.validation.ok, false);
  assert.deepEqual(ledger.validation.missingLiveEvidence, [
    {
      roundId: 'round-01',
      side: 'cursor-agent-computer-use',
      requirementIds: ['command-expansion', 'edit-diff-expansion'],
    },
  ]);
  assert.equal(ledger.rounds[0]?.evidenceCoverage.requirementCoverage[0]?.missingSides.length, 0);
  assert.deepEqual(ledger.rounds[0]?.evidenceCoverage.requirementCoverage[1]?.missingSides, ['cursor-agent-computer-use']);
});

test('canonical live alignment ledger validates with only sub-agent parity open', async () => {
  const rawLedger = JSON.parse(
    await readFile(new URL('../../../../docs/agent-desktop-alignment-evidence/live-ledger-2026-05-30.json', import.meta.url), 'utf8'),
  ) as AgentDesktopAlignmentLiveLedgerInput & { schemaVersion?: string };
  const ledger = createAgentDesktopAlignmentLiveLedger(rawLedger);
  const openDifferences = ledger.rounds.flatMap((round) => (
    round.differences.filter((difference) => difference.status !== 'closed' && difference.status !== 'wont-fix')
  ));
  const openRequirementIds = Array.from(new Set(openDifferences.flatMap((difference) => difference.requirementIds)));
  const completedRoundTimes = ledger.rounds.map((round) => Date.parse(round.completedAt ?? '')).filter(Number.isFinite);
  const latestRound = ledger.rounds.at(-1);
  const allowedCategories = new Set([
    'sidebar',
    'chat-process',
    'right-side-presentation',
    'interaction-semantics',
    'protocol-boundary',
    'redaction',
    'test-coverage',
    'documentation',
  ]);

  assert.equal(rawLedger.schemaVersion, AGENT_DESKTOP_ALIGNMENT_LIVE_LEDGER_SCHEMA_VERSION);
  assert.equal(ledger.validation.ok, true);
  assert.equal(ledger.status, 'active');
  assert.ok(completedRoundTimes.length > 0);
  assert.ok(Date.parse(ledger.recordedAt ?? '') >= Math.max(...completedRoundTimes));
  assert.equal(latestRound?.roundId, 'live-round-15');
  assert.deepEqual(ledger.validation.rejectedEvidenceIds, []);
  assert.deepEqual(ledger.validation.missingLiveEvidence, []);
  assert.deepEqual(ledger.validation.openDifferenceIds, ['diff:round-03-missing-command-diff-subagent-live-coverage']);
  assert.deepEqual(openDifferences.map((difference) => difference.id), ledger.validation.openDifferenceIds);
  assert.deepEqual(openRequirementIds, ['sub-agent-expansion']);
  for (const difference of ledger.rounds.flatMap((round) => round.differences)) {
    assert.ok(allowedCategories.has(difference.category), `unknown difference category ${difference.category}`);
  }
  assert.match(openDifferences[0]?.summary ?? '', /Codex app-server sub-agent evidence/i);
  assert.match(openDifferences[0]?.summary ?? '', /Cursor Agent.*NO_SUBAGENT_TOOL_AVAILABLE/i);
  assert.doesNotMatch(openDifferences[0]?.summary ?? '', /positive cursor/i);
  assert.match(openDifferences[0]?.impactScope ?? '', /sub-agent transcript\/ref action/i);
  assert.doesNotMatch(openDifferences[0]?.minimumGenericFix ?? '', /\[clipped\]/i);
  assert.ok(openDifferences[0]?.requires.code);
  assert.ok(openDifferences[0]?.requires.protocol);
  assert.ok(openDifferences[0]?.retestEvidenceRefs.some((ref) => ref.includes('round-06-sciforge-subagent-tool-unavailable')));
  assert.ok(openDifferences[0]?.retestEvidenceRefs.some((ref) => ref.includes('round-10-sciforge-subagent-live-positive')));
  assert.ok(openDifferences[0]?.retestEvidenceRefs.some((ref) => ref.includes('round-10-cursor-subagent-tool-unavailable')));
});

test('difference schema requires generic fix metadata, test refs, PROJECT TODO refs, and retest evidence before closing', () => {
  const ledger = createAgentDesktopAlignmentLiveLedger({
    ledgerId: 'live-ledger:invalid-differences',
    status: 'active',
    rounds: [
      {
        roundId: 'round-01',
        status: 'retest-needed',
        observationEntryPoints: [
          { side: 'sciforge-browser', entryPoint: 'SciForge Browser', refs: ['browser:round-01-sciforge'] },
          { side: 'cursor-agent-computer-use', entryPoint: 'Cursor Agent desktop', refs: ['computer-use:round-01-cursor'] },
        ],
        coverage: {
          surfaces: ['chat'],
          requirementIds: ['command-expansion'],
          summary: 'Command expansion difference audit.',
        },
        steps: completedLiveLoopSteps(),
        evidence: [
          sciforgeEvidence('sciforge-command-diff', ['command-expansion'], ['browser:round-01-command']),
          cursorEvidence('cursor-command-diff', ['command-expansion'], ['computer-use:round-01-command']),
        ],
        differences: [
          {
            id: 'diff:open-without-todo',
            category: 'chat-process',
            surface: 'chat',
            requirementIds: ['command-expansion'],
            status: 'open',
            impactScope: 'Command output expansion differs near provider URL https://provider.example and /Users/alice/project.',
            requires: {},
            minimumGenericFix: '',
            decision: 'fix-generically',
            evidenceRefs: ['browser:round-01-command'],
            testRefs: [],
          },
          {
            ...closedDifference('diff:closed-without-retest', ['command-expansion']),
            retestEvidenceRefs: [],
          },
        ],
        correctionDecision: {
          status: 'planned',
          summary: 'Differences need generic closure metadata.',
          refs: ['PROJECT.md'],
        },
        verification: {
          status: 'passed',
          summary: 'Schema validation ran.',
          refs: ['src/ui/src/app/agentDesktopAlignmentEvidence.test.ts'],
        },
        redactionCheck: {
          status: 'passed',
          summary: 'Redaction schema checked.',
          refs: ['src/ui/src/app/agentDesktopAlignmentEvidence.test.ts'],
        },
      },
    ],
  });

  const serialized = JSON.stringify(ledger);

  assert.equal(ledger.validation.ok, false);
  assert.ok(ledger.validation.diagnostics.some((diagnostic) => diagnostic.includes('must carry a PROJECT.md TODO ref')));
  assert.ok(ledger.validation.diagnostics.some((diagnostic) => diagnostic.includes('must mark at least one required fix area')));
  assert.ok(ledger.validation.diagnostics.some((diagnostic) => diagnostic.includes('must describe a minimum generic fix')));
  assert.ok(ledger.validation.diagnostics.some((diagnostic) => diagnostic.includes('must carry at least one logical ref')));
  assert.ok(ledger.validation.diagnostics.some((diagnostic) => diagnostic.includes('must carry retest evidence refs before closing')));
  assert.doesNotMatch(serialized, /provider\.example|\/Users\/alice/);
});

function sciforgeEvidence(
  id: string,
  requirementIds: AgentDesktopAlignmentRequirementId[],
  refs: string[],
  patch: Partial<AgentDesktopAlignmentEvidenceInput> = {},
): AgentDesktopAlignmentEvidenceInput {
  return {
    id,
    side: 'sciforge-browser',
    source: { tool: 'browser', target: 'sciforge-web', ref: `browser:${id}` },
    requirementIds,
    refs,
    summary: 'SciForge Browser evidence observed the required interaction through refs.',
    ...patch,
  };
}

function completedLiveLoopSteps(): AgentDesktopAlignmentLiveLoopStepInput[] {
  return AGENT_DESKTOP_ALIGNMENT_LIVE_LOOP.map((id) => ({
    id,
    status: 'completed',
    refs: [`loop-step:${id}`],
  }));
}

function openDifference(
  id: string,
  requirementIds: AgentDesktopAlignmentRequirementId[],
): AgentDesktopAlignmentDifferenceInput {
  return {
    id,
    category: 'right-side-presentation',
    surface: 'presentation',
    requirementIds,
    status: 'open',
    impactScope: 'Right-side presentation requires live dual-side comparison.',
    requires: { 'live-evidence': true, documentation: true },
    minimumGenericFix: 'Capture live dual-side refs and register any UI/protocol delta as a generic TODO.',
    decision: 'defer-with-todo',
    evidenceRefs: ['browser:round-01-sciforge'],
    testRefs: ['src/ui/src/app/agentDesktopAlignmentEvidence.test.ts'],
    projectTodoRef: 'PROJECT.md',
  };
}

function closedDifference(
  id: string,
  requirementIds: AgentDesktopAlignmentRequirementId[],
): AgentDesktopAlignmentDifferenceInput {
  return {
    id,
    category: 'chat-process',
    surface: 'chat',
    requirementIds,
    status: 'closed',
    impactScope: 'Action details need a bounded, refs-first expansion schema.',
    requires: { code: true, test: true },
    minimumGenericFix: 'Represent action details through generic refs and bounded summaries shared by both live sides.',
    decision: 'fix-generically',
    evidenceRefs: ['browser:round-01-sciforge', 'computer-use:round-01-cursor'],
    testRefs: ['src/ui/src/app/agentDesktopAlignmentEvidence.test.ts'],
    retestEvidenceRefs: ['browser:round-01-retest', 'computer-use:round-01-retest'],
  };
}

function cursorEvidence(
  id: string,
  requirementIds: AgentDesktopAlignmentRequirementId[],
  refs: string[],
  patch: Partial<AgentDesktopAlignmentEvidenceInput> = {},
): AgentDesktopAlignmentEvidenceInput {
  return {
    id,
    side: 'cursor-agent-computer-use',
    source: { tool: 'computer-use', target: 'cursor-agent-desktop', ref: `computer-use:${id}` },
    requirementIds,
    refs,
    summary: 'Cursor Agent Computer Use evidence observed the baseline interaction through refs.',
    ...patch,
  };
}
