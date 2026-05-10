import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE,
  AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
  AGENTSERVER_SUPPLEMENTAL_GENERATION_EVENT_TYPE,
  agentServerGeneratedEntrypointContractReason,
  agentServerBackendDecisionPromptPolicyLines,
  agentServerCapabilityRoutingPromptPolicyLines,
  agentServerContinuationPromptPolicyLines,
  agentServerCurrentTurnSnapshotPromptPolicyLines,
  agentServerGeneratedTaskInterfaceContractReason,
  agentServerExecutionModePromptPolicyLines,
  agentServerExternalIoReliabilityContractLines,
  agentServerFreshRetrievalPromptPolicyLines,
  agentServerGeneratedTaskPromptPolicyLines,
  agentServerGenerationOutputContract,
  agentServerGenerationOutputContractLines,
  agentServerLargeFilePromptContractLines,
  agentServerPriorAttemptsPromptPolicyLines,
  agentServerGeneratedTaskRetryDetail,
  agentServerPathOnlyStrictRetryDirectPayloadReason,
  agentServerPathOnlyStrictRetryStillMissingReason,
  agentServerPathOnlyTaskFilesReason,
  agentServerPayloadTaskDomain,
  agentServerRepairPromptPolicyLines,
  agentServerStablePayloadTaskId,
  agentServerViewSelectionPromptPolicyLines,
  agentServerWorkspaceTaskRepairPromptPolicyLines,
  agentServerWorkspaceTaskRoutingPromptPolicyLines,
  EVOLVED_SKILLS_RELATIVE_DIR,
  SKILL_ENTRYPOINT_TYPE,
  skillManifestHasWorkspaceTaskEntrypoint,
  skillManifestPathIsEvolvedWorkspaceSkill,
  skillManifestUsesAgentServerGeneration,
  skillPromotionShouldPropose,
  skillRuntimeLanguageForManifest,
  skillRuntimeTaskFileNameForManifest,
  skillRuntimeRoutePolicy,
  skillPromotionDomain,
  taskProjectStageAdapterSkillAvailability,
  workspaceTaskPythonCommandCandidates,
} from './runtime-policy';

test('skills runtime policy owns AgentServer retrieval and task prompt snippets', () => {
  const executionMode = agentServerExecutionModePromptPolicyLines().join('\n');
  assert.match(executionMode, /thin-reproducible-adapter/);
  assert.match(executionMode, /For lightweight search\/news\/current-events lookups/);
  assert.match(executionMode, /For heavy or durable work/);

  const taskPolicy = agentServerGeneratedTaskPromptPolicyLines().join('\n');
  assert.match(taskPolicy, /taskFiles MUST be an array/);
  assert.match(taskPolicy, /entrypoint\.path MUST reference/);
  assert.match(taskPolicy, /physically write task files/);
  assert.match(taskPolicy, /Entrypoint contract/);
  assert.match(taskPolicy, /inputPath argument/);

  assert.match(agentServerCurrentTurnSnapshotPromptPolicyLines().join('\n'), /CURRENT TURN SNAPSHOT/);
  assert.match(agentServerBackendDecisionPromptPolicyLines({ freshCurrentTurn: true }).join('\n'), /FRESH GENERATION MODE/);
  assert.match(agentServerBackendDecisionPromptPolicyLines({ freshCurrentTurn: false }).join('\n'), /CONTINUITY MODE/);
  assert.equal(agentServerGenerationOutputContract().finalOutput, 'exactly one compact JSON object');
  assert.match(agentServerGenerationOutputContractLines().join('\n'), /Final output must be only compact JSON/);
  assert.match(agentServerWorkspaceTaskRoutingPromptPolicyLines().join('\n'), /generated task paths under \.sciforge\/tasks/);
  assert.match(agentServerCapabilityRoutingPromptPolicyLines().join('\n'), /Runtime capability routing contract/);
  assert.match(agentServerLargeFilePromptContractLines().join('\n'), /Large-file contract/);
  assert.match(agentServerViewSelectionPromptPolicyLines().join('\n'), /selectedComponentIds/);
  assert.match(agentServerContinuationPromptPolicyLines().join('\n'), /continuation requests/);
  assert.match(agentServerPriorAttemptsPromptPolicyLines().join('\n'), /RECENT PRIOR ATTEMPTS/);
  assert.match(agentServerWorkspaceTaskRepairPromptPolicyLines().join('\n'), /workspace ready for SciForge to rerun/);

  const freshRetrieval = agentServerFreshRetrievalPromptPolicyLines().join('\n');
  assert.match(freshRetrieval, /fresh retrieval\/analysis\/report requests/);

  const repair = agentServerRepairPromptPolicyLines().join('\n');
  assert.match(repair, /failureReason/);
  assert.match(repair, /logs are readable/);

  const externalIo = agentServerExternalIoReliabilityContractLines().join('\n');
  assert.match(externalIo, /External I\/O reliability contract/);
  assert.match(externalIo, /For provider-specific APIs/);
});

test('skills runtime policy owns generated task retry and interface contract semantics', () => {
  assert.match(agentServerGeneratedTaskRetryDetail('entrypoint'), /Retrying AgentServer generation once/);
  assert.match(agentServerGeneratedTaskRetryDetail('task-interface'), /generated tasks must consume/);

  const entrypointReason = agentServerGeneratedEntrypointContractReason({
    entrypoint: { path: '.sciforge/tasks/report.md', language: 'markdown' },
    taskFiles: [{ path: '.sciforge/tasks/report.md', language: 'markdown', content: '# Report' }],
  });
  assert.match(String(entrypointReason), /non-executable artifact\/report/);

  const interfaceReason = agentServerGeneratedTaskInterfaceContractReason({
    entryRel: '.sciforge/tasks/static.py',
    language: 'python',
    source: 'print("static answer")',
  });
  assert.match(String(interfaceReason), /does not read the SciForge inputPath argument and write the SciForge outputPath argument/);

  assert.equal(agentServerGeneratedTaskInterfaceContractReason({
    entryRel: '.sciforge/tasks/adapter.py',
    language: 'python',
    source: 'import sys\ninput_path = sys.argv[1]\noutput_path = sys.argv[2]\n',
  }), undefined);

  const pathOnly = agentServerPathOnlyTaskFilesReason(['.sciforge/tasks/a.py']);
  assert.match(pathOnly, /path-only taskFiles/);
  assert.match(agentServerPathOnlyStrictRetryDirectPayloadReason(pathOnly), /direct ToolPayload/);
  assert.match(agentServerPathOnlyStrictRetryStillMissingReason(pathOnly, ['.sciforge/tasks/a.py']), /Strict retry still returned path-only/);
});

test('skills runtime policy owns generated runner event and stable id policy', () => {
  assert.equal(AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE, 'agentserver-generation-retry');
  assert.equal(AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE, 'workspace-task-materialized');
  assert.equal(AGENTSERVER_SUPPLEMENTAL_GENERATION_EVENT_TYPE, 'workspace-task-start');
  assert.equal(agentServerPayloadTaskDomain('omics / spatial'), 'omics-spatial');
  assert.equal(agentServerPayloadTaskDomain('###'), 'runtime');
  assert.equal(agentServerStablePayloadTaskId({
    kind: 'direct',
    skillDomain: 'omics / spatial',
    skillId: 'agentserver.generate.omics',
    prompt: 'make report',
    runId: undefined,
    shortHash: () => 'abc123',
  }), 'agentserver-direct-omics-spatial-abc123');
});

test('skills runtime policy owns skill promotion domain normalization', () => {
  assert.equal(skillPromotionDomain('omics'), 'omics');
  assert.equal(skillPromotionDomain(undefined), 'literature');
  assert.equal(skillPromotionDomain('unknown'), 'literature');
});

test('skills runtime policy owns skill promotion entrypoint checks', () => {
  const workspaceManifest = {
    entrypoint: { type: SKILL_ENTRYPOINT_TYPE.WORKSPACE_TASK, command: 'python', path: './run.py' },
    environment: { language: 'python' },
  };
  assert.equal(skillManifestHasWorkspaceTaskEntrypoint(workspaceManifest), true);
  assert.equal(skillRuntimeLanguageForManifest(workspaceManifest), 'python');
  assert.equal(skillRuntimeTaskFileNameForManifest(workspaceManifest), 'run.py');
  assert.equal(skillRuntimeTaskFileNameForManifest({
    entrypoint: { type: SKILL_ENTRYPOINT_TYPE.WORKSPACE_TASK, path: './report.md' },
  }), 'task.py');
  assert.equal(skillManifestUsesAgentServerGeneration({
    entrypoint: { type: SKILL_ENTRYPOINT_TYPE.AGENTSERVER_GENERATION },
  }), true);
  assert.equal(skillManifestPathIsEvolvedWorkspaceSkill(`/tmp/ws/${EVOLVED_SKILLS_RELATIVE_DIR}/skill.json`), true);
  assert.equal(skillPromotionShouldPropose({
    skillKind: 'workspace',
    skillId: 'workspace.accepted',
    manifestPath: `/tmp/ws/${EVOLVED_SKILLS_RELATIVE_DIR}/skill.json`,
    entrypoint: { type: SKILL_ENTRYPOINT_TYPE.WORKSPACE_TASK },
    taskRel: '.sciforge/tasks/generated-run.py',
  }), false);
  assert.equal(skillPromotionShouldPropose({
    skillKind: 'installed',
    skillId: 'agentserver.generate.omics',
    manifestPath: 'agentserver://fallback',
    entrypoint: { type: SKILL_ENTRYPOINT_TYPE.AGENTSERVER_GENERATION },
    taskRel: '.sciforge/tasks/run.py',
  }), true);
  assert.equal(skillPromotionShouldPropose({
    skillKind: 'installed',
    skillId: 'workspace.repaired',
    manifestPath: '/tmp/skill.json',
    entrypoint: { type: SKILL_ENTRYPOINT_TYPE.WORKSPACE_TASK },
    taskRel: '.sciforge/tasks/run.py',
    selfHealed: true,
  }), true);
});

test('skills runtime policy owns TaskProject adapter fallback manifest', () => {
  const fallback = taskProjectStageAdapterSkillAvailability('omics', '2026-01-01T00:00:00.000Z');
  assert.equal(fallback.id, 'agentserver.generate.omics.task-project-stage-adapter');
  assert.equal(fallback.checkedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(fallback.manifest.entrypoint.type, SKILL_ENTRYPOINT_TYPE.AGENTSERVER_GENERATION);
});

test('skills runtime policy owns entrypoint route labels and profile ids', () => {
  assert.deepEqual(skillRuntimeRoutePolicy({
    entrypoint: { type: 'agentserver-generation' },
    agentServerRuntimeProfileId: 'agentserver-openai',
  }), {
    runtimeProfileId: 'agentserver-openai',
    selectedRuntime: 'agentserver-generation',
  });
  assert.deepEqual(skillRuntimeRoutePolicy({
    entrypoint: { type: 'markdown-skill' },
    agentServerRuntimeProfileId: 'agentserver-openai',
  }), {
    runtimeProfileId: 'agentserver-openai',
    selectedRuntime: 'agentserver-markdown-skill',
  });
  assert.deepEqual(skillRuntimeRoutePolicy({ entrypoint: { type: 'workspace-task' } }), {
    runtimeProfileId: 'workspace-python',
    selectedRuntime: 'workspace-python',
  });
  assert.deepEqual(skillRuntimeRoutePolicy({
    entrypoint: { type: 'inspector' },
    scenarioPackageSource: 'built-in',
  }), {
    runtimeProfileId: 'package-skill',
    selectedRuntime: 'inspector',
  });
});

test('skills runtime policy owns workspace task Python runtime candidates', () => {
  assert.deepEqual(workspaceTaskPythonCommandCandidates('/tmp/sciforge-workspace'), [
    '/tmp/sciforge-workspace/.venv-sciforge/bin/python',
    '/tmp/sciforge-workspace/.venv-sciforge-omics/bin/python',
    '/tmp/sciforge-workspace/.venv/bin/python',
    'python3',
  ]);
});
