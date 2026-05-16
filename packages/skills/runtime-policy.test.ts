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
  agentServerToolPayloadShapeContract,
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
  assert.match(taskPolicy, /Transport budget contract/);
  assert.match(taskPolicy, /single long string around 8k characters/);
  assert.match(taskPolicy, /Entrypoint contract/);
  assert.match(taskPolicy, /inputPath argument/);
  assert.match(taskPolicy, /outputPath is a JSON file path/);
  assert.match(taskPolicy, /Generated task compactness contract/);
  assert.match(taskPolicy, /Generated Python dependency contract/);
  assert.match(taskPolicy, /DataFrame\.to_markdown requires tabulate/);
  assert.match(taskPolicy, /ToolPayload write/);
  assert.match(taskPolicy, /every artifact should include stable id and type/);
  assert.match(taskPolicy, /claims, uiManifest, executionUnits, and artifacts as arrays/);
  assert.match(taskPolicy, /never use an object descriptor/);
  assert.match(taskPolicy, /Provider-first generated task contract/);
  assert.match(taskPolicy, /sciforge_task/);
  assert.match(taskPolicy, /invoke_capability/);
  assert.match(taskPolicy, /invoke_provider/);
  assert.match(taskPolicy, /do not use direct network packages or APIs such as requests, urllib, httpx, aiohttp/);

  assert.match(agentServerCurrentTurnSnapshotPromptPolicyLines().join('\n'), /CURRENT TURN SNAPSHOT/);
  assert.match(agentServerBackendDecisionPromptPolicyLines({ freshCurrentTurn: true }).join('\n'), /FRESH GENERATION MODE/);
  assert.match(agentServerBackendDecisionPromptPolicyLines({ freshCurrentTurn: false }).join('\n'), /CONTINUITY MODE/);
  assert.equal(agentServerGenerationOutputContract().finalOutput, 'exactly one compact JSON object');
  assert.match(agentServerGenerationOutputContract().uiManifest, /array of component slots/);
  assert.deepEqual(agentServerToolPayloadShapeContract().arrayFields, ['claims', 'uiManifest', 'executionUnits', 'artifacts']);
  assert.match(agentServerToolPayloadShapeContract().uiManifestShape.forbiddenShape, /preferredView/);
  assert.match(agentServerGenerationOutputContractLines().join('\n'), /Final output must be only compact JSON/);
  assert.match(agentServerGenerationOutputContractLines().join('\n'), /Transport cap/);
  assert.match(agentServerGenerationOutputContractLines().join('\n'), /ToolPayload array contract/);
  assert.match(agentServerWorkspaceTaskRoutingPromptPolicyLines().join('\n'), /generated task paths under the current session bundle tasks directory/);
  assert.match(agentServerCapabilityRoutingPromptPolicyLines().join('\n'), /Runtime capability routing contract/);
  assert.match(agentServerCapabilityRoutingPromptPolicyLines().join('\n'), /capabilityProviderRoutes/);
  assert.match(agentServerCapabilityRoutingPromptPolicyLines().join('\n'), /invoke_capability/);
  assert.match(agentServerCapabilityRoutingPromptPolicyLines().join('\n'), /Provider-first authoring template/);
  assert.match(agentServerLargeFilePromptContractLines().join('\n'), /Large-file contract/);
  assert.match(agentServerViewSelectionPromptPolicyLines().join('\n'), /selectedComponentIds/);
  assert.match(agentServerContinuationPromptPolicyLines().join('\n'), /continuation requests/);
  assert.match(agentServerPriorAttemptsPromptPolicyLines().join('\n'), /RECENT PRIOR ATTEMPTS/);
  const workspaceRepair = agentServerWorkspaceTaskRepairPromptPolicyLines().join('\n');
  assert.match(workspaceRepair, /workspace ready for SciForge to rerun/);
  assert.match(workspaceRepair, /to_markdown\/tabulate/);
  assert.match(workspaceRepair, /task bootstrap/);

  const freshRetrieval = agentServerFreshRetrievalPromptPolicyLines().join('\n');
  assert.match(freshRetrieval, /fresh retrieval\/analysis\/report requests/);

  const repair = agentServerRepairPromptPolicyLines().join('\n');
  assert.match(repair, /failureReason/);
  assert.match(repair, /logs are readable/);

  const externalIo = agentServerExternalIoReliabilityContractLines().join('\n');
  assert.match(externalIo, /External I\/O reliability contract/);
  assert.match(externalIo, /For provider-specific APIs/);
  assert.match(externalIo, /Ready SciForge web_search\/web_fetch provider routes override custom HTTP code/);
  assert.match(externalIo, /failed-with-reason or repair-needed payloads/);
});

test('skills runtime policy owns generated task retry and interface contract semantics', () => {
  assert.match(agentServerGeneratedTaskRetryDetail('entrypoint'), /Retrying AgentServer generation once/);
  assert.match(agentServerGeneratedTaskRetryDetail('task-interface'), /generated tasks must consume/);
  assert.match(agentServerGeneratedTaskRetryDetail('provider-first-recovery-adapter'), /deterministic provider-first recovery adapter/);

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
    source: 'import json, sys\nfrom pathlib import Path\ninput_path = sys.argv[1]\noutput_path = sys.argv[2]\nPath(output_path).write_text(json.dumps({"message":"ok","claims":[],"uiManifest":[],"executionUnits":[],"artifacts":[]}))\n',
  }), undefined);

  assert.match(String(agentServerGeneratedTaskInterfaceContractReason({
    entryRel: '.sciforge/tasks/stdout-only.py',
    language: 'python',
    source: 'import json, os, sys\ninput_path = sys.argv[1]\noutput_path = sys.argv[2]\nos.makedirs(output_path, exist_ok=True)\nprint(json.dumps({"message":"ok"}))\n',
  })), /write the SciForge outputPath argument/);

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
