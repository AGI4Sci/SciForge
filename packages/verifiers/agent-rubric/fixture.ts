import type { AgentVerifierRubric, AgentVerifierRequest } from '../../../src/shared/verifiers/agentRubric.js';

export const agentVerifierRubricFixture: AgentVerifierRubric = {
  id: 'fixture.agent-rubric.basic-artifact-trace',
  version: '1.0.0',
  summary: '检查目标、artifact refs 和 trace refs 是否足以支持 agent critique/reward。',
  passThreshold: 0.8,
  needsHumanThreshold: 0.5,
  criteria: [
    {
      id: 'goal-grounding',
      description: '验证请求必须保留清晰目标',
      weight: 1,
      requiredEvidenceKinds: ['result'],
    },
    {
      id: 'artifact-evidence',
      description: '关键产物必须以 artifact refs 形式进入验证',
      weight: 2,
      requiredEvidenceKinds: ['artifact'],
    },
    {
      id: 'trace-evidence',
      description: '验证者必须能引用执行或观察 trace refs',
      weight: 2,
      requiredEvidenceKinds: ['trace'],
    },
  ],
};

export const agentVerifierRequestFixture: AgentVerifierRequest = {
  goal: '确认生成结果满足用户目标，并指出下一轮可修复项。',
  resultRefs: ['result:final-answer'],
  artifactRefs: ['artifact:report-json'],
  traceRefs: ['trace:run-001'],
  rubric: agentVerifierRubricFixture,
};
