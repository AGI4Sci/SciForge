import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCapabilityBrief,
  createCapabilityRegistry,
  defaultCapabilitySummaries,
  type CapabilityContract,
} from './capabilityRegistry';

test('按 observe/reasoning/action/verify/interactive-view 分类暴露紧凑 brief', () => {
  const brief = buildCapabilityBrief({
    prompt: '请查看截图并生成一个预览草稿 report',
    domain: 'knowledge',
    expectedArtifactTypes: ['report'],
  });

  assert.equal(brief.schemaVersion, 'sciforge.capability-brief.v1');
  assert.equal(brief.loadingPolicy.briefOnly, true);
  assert.equal(brief.loadingPolicy.contractLoading, 'lazy-selected-capabilities-only');
  assert.ok(brief.selectedSkills.every((item) => item.category === 'reasoning' && item.kind === 'skill'));
  assert.ok(brief.selectedSenses.every((item) => item.category === 'observe' && item.kind === 'sense'));
  assert.ok(brief.selectedActions.every((item) => item.category === 'action'));
  assert.ok(brief.selectedVerifiers.every((item) => item.category === 'verify' && item.kind === 'verifier'));
  assert.ok(brief.selectedComponents.every((item) => item.category === 'interactive-view'));
  assert.ok(JSON.stringify(brief).length < 9_000, 'brief 应保持紧凑，避免把 package 文档塞进上下文');
});

test('registry 只列出 brief，并在选中 capability 后懒加载 contract', async () => {
  let loaded = 0;
  const contract: CapabilityContract = {
    id: 'verifier.custom',
    schemaVersion: 'sciforge.capability-contract.v1',
    inputContract: { largeContract: 'only loaded after selected' },
  };
  const registry = createCapabilityRegistry([
    {
      summary: {
        id: 'verifier.custom',
        kind: 'verifier',
        category: 'verify',
        oneLine: '自定义验证器摘要。',
        domains: ['knowledge'],
        triggers: ['custom'],
        antiTriggers: [],
        modalities: ['json'],
        producesArtifactTypes: ['verification-result'],
        riskClass: 'medium',
        costClass: 'low',
        latencyClass: 'low',
        reliability: 'schema-checked',
        requiresNetwork: false,
        requiredConfig: [],
        verifierTypes: ['schema'],
        detailRef: 'local://contract',
      },
      loadContract: () => {
        loaded += 1;
        return contract;
      },
    },
  ]);

  const briefs = registry.listBriefs('verify');
  assert.equal(loaded, 0);
  assert.deepEqual(briefs.map((item) => item.id), ['verifier.custom']);
  assert.equal(briefs[0]?.oneLine, '自定义验证器摘要。');

  assert.deepEqual(await registry.loadContract('verifier.custom'), contract);
  assert.equal(loaded, 1);
});

test('高风险 action 默认需要 verifier 或 human approval', () => {
  const brief = buildCapabilityBrief({
    prompt: '发布最终报告并写入外部系统',
    domain: 'literature',
    expectedArtifactTypes: ['scientific-report'],
    riskLevel: 'high',
    actionSideEffects: ['external-write', 'publish'],
  });

  assert.equal(brief.intent.riskLevel, 'high');
  assert.equal(brief.verificationPolicy.required, true);
  assert.ok(['human', 'hybrid'].includes(brief.verificationPolicy.mode));
  assert.ok(
    brief.verificationPolicy.selectedVerifierIds.length > 0 || brief.verificationPolicy.humanApprovalRequired,
    '高风险 action 必须选择 verifier 或要求 human approval',
  );
  assert.ok(brief.verificationBrief.riskSignals.includes('sideEffect:publish'));
});

test('低风险草稿允许 unverified 但必须记录原因', () => {
  const summaries = defaultCapabilitySummaries().filter((summary) => summary.category !== 'verify');
  const brief = buildCapabilityBrief({
    prompt: '先写一个低风险预览草稿，不验证',
    domain: 'knowledge',
    expectedArtifactTypes: ['draft'],
    riskLevel: 'low',
    userExplicitVerification: 'none',
    summaries,
  });

  assert.equal(brief.verificationPolicy.required, false);
  assert.equal(brief.verificationPolicy.mode, 'none');
  assert.match(brief.verificationPolicy.unverifiedReason ?? '', /低风险草稿/);
  assert.deepEqual(brief.verificationPolicy.selectedVerifierIds, []);
});

test('artifact type、side effects 和用户显式要求共同影响 verifier 选择', () => {
  const brief = buildCapabilityBrief({
    prompt: '请人工确认这个科研结论报告，并检查文件 diff',
    domain: 'omics',
    expectedArtifactTypes: ['statistical-result', 'evidence-report'],
    riskLevel: 'medium',
    actionSideEffects: ['workspace-write'],
    userExplicitVerification: 'human',
  });

  assert.equal(brief.verificationPolicy.required, true);
  assert.equal(brief.verificationPolicy.mode, 'human');
  assert.ok(brief.verificationPolicy.selectedVerifierIds.includes('verifier.human-approval'));
  assert.ok(
    brief.verificationPolicy.selectedVerifierIds.some((id) => id === 'verifier.environment-diff' || id === 'verifier.agent-rubric'),
    'side effects 或科研结论应带来环境/agent verifier 候选',
  );
});
