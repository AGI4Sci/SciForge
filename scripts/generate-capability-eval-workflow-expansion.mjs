#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const planPath = path.join(root, 'eval-cases/capability/action-directed-plan.jsonl')
const outputPath = path.join(root, 'eval-cases/capability/workflow-expansion-plan.jsonl')
const caseOutputPath = path.join(root, 'eval-cases/capability/workflow-expansion-cases.jsonl')
const markdownPath = path.join(root, 'docs/generated/capability-workflow-expansion-plan.md')
const checkOnly = process.argv.includes('--check')

const plans = (await readJsonl(planPath)).sort((left, right) => left.actionId.localeCompare(right.actionId))
const owners = [...new Set(plans.map((plan) => plan.owner))].sort()
const byOwner = new Map(owners.map((owner) => [owner, plans.filter((plan) => plan.owner === owner)]))
const entries = [
  ...createSameDomainEntries(),
  ...createCrossDomainEntries(),
  ...createRecoveryBoundaryEntries()
]
const content = `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
const caseContent = `${entries.map(toEvalCase).map((entry) => JSON.stringify(entry)).join('\n')}\n`
const markdown = renderMarkdown(entries)

if (checkOnly) {
  const [currentContent, currentCases, currentMarkdown] = await Promise.all([
    readFile(outputPath, 'utf8'),
    readFile(caseOutputPath, 'utf8'),
    readFile(markdownPath, 'utf8')
  ])
  if (currentContent !== content || currentCases !== caseContent || currentMarkdown !== markdown) {
    throw new Error('Workflow expansion plan is stale. Run npm run capability:eval:workflow-expansion.')
  }
  const { loadEvalCasesFromJsonl } = await import('../src/main/capability-eval/loader.ts')
  const cases = await loadEvalCasesFromJsonl(caseOutputPath)
  if (cases.length !== entries.length) throw new Error(`Workflow expansion case count ${cases.length} does not match plan count ${entries.length}.`)
  console.log(`Verified workflow expansion plan and executable cases: ${entries.length} entries.`)
} else {
  await writeFile(outputPath, content, 'utf8')
  await writeFile(caseOutputPath, caseContent, 'utf8')
  await writeFile(markdownPath, markdown, 'utf8')
  console.log(`Generated workflow expansion plan and executable cases with ${entries.length} entries.`)
}

function createSameDomainEntries() {
  const templates = [
    'read-state-and-report', 'read-empty-and-missing', 'write-and-readback', 'write-idempotency',
    'transform-and-validate', 'join-and-validate', 'resource-create-and-list', 'resource-update-and-read',
    'resource-delete-and-absence', 'version-create-and-compare', 'version-restore-and-verify', 'comment-and-thread-readback',
    'compute-success-and-artifact', 'compute-blocked-and-diagnostics', 'preview-and-export', 'review-and-package',
    'checkpoint-and-resume', 'provider-status-and-operation'
  ]
  return templates.map((template, index) => {
    const owner = owners[index % owners.length]
    const actionCount = [
      'read-state-and-report', 'write-and-readback', 'write-idempotency',
      'resource-create-and-list', 'resource-update-and-read', 'resource-delete-and-absence',
      'version-create-and-compare', 'version-restore-and-verify', 'comment-and-thread-readback',
      'compute-success-and-artifact', 'preview-and-export', 'review-and-package',
      'checkpoint-and-resume', 'provider-status-and-operation'
    ].includes(template) || index % 5 === 0 ? 2 : 1
    return createEntry({
      category: 'same-domain',
      index,
      idPrefix: 'workflow-expansion-same-domain',
      template,
      ownerPair: [owner],
      actionCount
    })
  })
}

function createCrossDomainEntries() {
  const templates = [
    'research-to-plot', 'dataset-to-plot', 'plot-to-review', 'artifact-to-preview',
    'version-to-checkpoint', 'evidence-to-project', 'biology-to-evidence', 'remote-to-preview',
    'workflow-to-artifact', 'paper-to-dataset', 'checkpoint-to-review', 'browser-to-feedback'
  ]
  const ownerPairs = {
    'research-to-plot': ['paper-radar', 'scientific-plotting'],
    'dataset-to-plot': ['dataset-api', 'scientific-plotting'],
    'plot-to-review': ['scientific-plotting', 'visual-review'],
    'artifact-to-preview': ['artifact-versions', 'browser-preview'],
    'version-to-checkpoint': ['artifact-versions', 'git-checkpoints'],
    'evidence-to-project': ['evidence-dag', 'project-dag'],
    'biology-to-evidence': ['biology-room', 'evidence-dag'],
    'remote-to-preview': ['remote-ssh', 'browser-preview'],
    'workflow-to-artifact': ['create-loop', 'artifact-versions'],
    'paper-to-dataset': ['paper-radar', 'dataset-api'],
    'checkpoint-to-review': ['research-checkpoints', 'visual-review'],
    'browser-to-feedback': ['browser-preview', 'anchored-comments']
  }
  return templates.map((template, index) => {
    const selectedOwners = ownerPairs[template] ?? [owners[index % owners.length], owners[(index + 3) % owners.length]]
    return createEntry({
      category: 'cross-domain',
      index,
      idPrefix: 'workflow-expansion-cross-domain',
      template,
      ownerPair: selectedOwners,
      actionCount: 1
    })
  })
}

function createRecoveryBoundaryEntries() {
  const templates = [
    'empty-result', 'invalid-input', 'no-capability-call', 'reasonable-alternative',
    'approval-denied', 'approval-allowed', 'transient-timeout-recovery', 'persistent-provider-failure',
    'expired-resource', 'idempotent-replay', 'cancel-no-side-effect', 'cross-workspace-isolation'
  ]
  const candidates = plans.filter((plan) => (plan.boundary?.obligations ?? []).length > 0)
  return templates.map((template, index) => {
    const plan = selectRecoveryPlan(template, candidates, index)
    return createEntry({
      category: 'recovery-boundary',
      index,
      idPrefix: 'workflow-expansion-recovery-boundary',
      template,
      ownerPair: [plan.owner],
      actionCount: 1
    })
  })
}

function selectRecoveryPlan(template, candidates, index) {
  const obligationByTemplate = {
    'invalid-input': 'invalid-input-or-missing-resource',
    'approval-denied': 'approval-denied-no-side-effect',
    'approval-allowed': 'approval-allowed',
    'expired-resource': 'invalid-input-or-missing-resource',
    'idempotent-replay': 'idempotency-replay',
    'cancel-no-side-effect': 'cancel-no-side-effect'
  }
  const obligation = obligationByTemplate[template]
  const matching = obligation
    ? candidates.filter((plan) => plan.boundary.obligations.includes(obligation))
    : []
  const effectByTemplate = {
    'empty-result': 'read',
    'reasonable-alternative': 'read',
    'transient-timeout-recovery': 'compute',
    'persistent-provider-failure': 'external-write',
    'cross-workspace-isolation': 'workspace-write'
  }
  const effect = effectByTemplate[template]
  const effectMatching = effect ? candidates.filter((plan) => plan.effect === effect) : []
  const pool = matching.length > 0 ? matching : effectMatching.length > 0 ? effectMatching : candidates
  return pool[index % pool.length]
}

function createEntry({ category, index, idPrefix, template, ownerPair, actionCount }) {
  const selected = template === 'no-capability-call'
    ? []
    : ownerPair.flatMap((owner, ownerIndex) => selectActions(
      owner,
      index + ownerIndex,
      actionCountForOwners(actionCount, ownerPair.length),
      template,
      ownerIndex
    ))
  const actionIds = [...new Set(selected.map((plan) => plan.actionId))]
  const actionPlans = actionIds.map((actionId) => plans.find((plan) => plan.actionId === actionId)).filter(Boolean)
  if (actionPlans.length !== actionIds.length) {
    throw new Error(`Workflow ${idPrefix}-${String(index + 1).padStart(2, '0')} selected an unknown action.`)
  }
  const readiness = actionIds.every((actionId) => {
    const plan = plans.find((candidate) => candidate.actionId === actionId)
    return plan?.fixture?.status === 'ready' && plan?.oracle?.status === 'ready'
  }) ? 'ready' : 'blocked'
  const workflowType = category === 'cross-domain'
    ? 'cross-domain'
    : actionIds.length > 1 || category === 'recovery-boundary'
      ? 'multi-step'
      : 'single-action'
  const businessIntent = businessIntentFor(category, template)
  const acceptanceCriteria = acceptanceCriteriaFor(category)
  return {
    schemaVersion: 'sciforge.capability-eval.workflow-expansion.v1',
    id: `${idPrefix}-${String(index + 1).padStart(2, '0')}`,
    category,
    template,
    status: 'planned',
    query: category === 'cross-domain'
      ? `把 ${ownerPair[0]} 产生的真实结果传递给 ${ownerPair[1]}，${businessIntent}。验收要求：${acceptanceCriteria}。`
      : `在 ${ownerPair[0]} 领域，${businessIntent}。验收要求：${acceptanceCriteria}。`,
    businessIntent,
    acceptanceCriteria,
    tags: ['workflow', 'planned', category, template],
    workflowType,
    requiredActions: actionIds,
    packageOwners: ownerPair,
    fixtureStrategy: fixtureStrategyFor(actionIds),
    oracleStrategy: oracleStrategyFor(actionIds),
    boundaryObligations: [...new Set(actionIds.flatMap((actionId) => plans.find((plan) => plan.actionId === actionId)?.boundary?.obligations ?? []))],
    runStrategy: {
      live: 'isolated-live-agent',
      replay: 'same-trace-replay',
      preserve: ['run-manifest', 'raw-trace', 'normalized-sidecar', 'workspace-snapshot', 'oracle-evidence']
    },
    readiness,
    blocker: readiness === 'ready' ? null : 'one or more package fixture/oracle contributions are not ready'
  }
}

function businessIntentFor(category, template) {
  const intents = {
    'read-state-and-report': '读取已有资源状态并生成可复核摘要',
    'read-empty-and-missing': '分别验证空结果与资源不存在时的可解释返回',
    'write-and-readback': '创建或更新资源后重新读取并核对写入内容',
    'write-idempotency': '使用同一幂等键重复提交写入并确认不产生重复副作用',
    'transform-and-validate': '执行数据转换并验证输出结构和关键字段',
    'join-and-validate': '合并两个关联数据集并验证匹配与缺失记录',
    'resource-create-and-list': '创建资源后从列表中确认它可见且身份一致',
    'resource-update-and-read': '更新资源元数据后读取并核对版本变化',
    'resource-delete-and-absence': '删除资源后确认读取返回不存在且没有残留',
    'version-create-and-compare': '创建新版本并与旧版本比较变更内容',
    'version-restore-and-verify': '恢复历史版本并验证当前内容与版本身份',
    'comment-and-thread-readback': '添加评论后读取线程并核对作者和正文',
    'compute-success-and-artifact': '执行计算并验证结果摘要与产物文件',
    'compute-blocked-and-diagnostics': '触发计算阻塞并验证诊断信息和无额外副作用',
    'preview-and-export': '生成预览并导出可交付文件',
    'review-and-package': '提交评审并打包可追溯的评审证据',
    'checkpoint-and-resume': '创建检查点后恢复任务并核对恢复状态',
    'provider-status-and-operation': '检查提供方状态后执行一次受控操作',
    'research-to-plot': '用研究结果生成带来源标识的图表',
    'dataset-to-plot': '把数据集转换成图表并核对数据血缘',
    'plot-to-review': '把图表交给评审流程并生成评审包',
    'artifact-to-preview': '把产物加载到预览流程并确认页面状态',
    'version-to-checkpoint': '从指定版本建立检查点并验证可恢复',
    'evidence-to-project': '把证据节点关联到项目并读回关联关系',
    'biology-to-evidence': '把生物分析结果登记为可追溯证据',
    'remote-to-preview': '把远端资源安全地加载到本地预览',
    'workflow-to-artifact': '运行工作流并生成可核验的交付产物',
    'paper-to-dataset': '从论文结果构造数据集并核对来源字段',
    'checkpoint-to-review': '把检查点状态提交给评审并核对版本',
    'browser-to-feedback': '从浏览器状态生成受控反馈并确认提交结果',
    'empty-result': '验证空结果被明确报告且任务没有伪造成功',
    'invalid-input': '提交无效输入并确认错误可解释且没有副作用',
    'no-capability-call': '在无需工具时直接给出结果且不调用能力',
    'reasonable-alternative': '主路径不可用时选择允许的替代能力并完成任务',
    'approval-denied': '拒绝审批后确认操作终止且没有外部副作用',
    'approval-allowed': '批准后完成受控写入并核验结果',
    'transient-timeout-recovery': '遇到一次超时后按上限重试并恢复成功',
    'persistent-provider-failure': '持续失败时报告明确错误并停止无效重试',
    'expired-resource': '使用过期资源时报告失效并避免写入',
    'idempotent-replay': '重放同一请求并确认结果稳定且没有重复副作用',
    'cancel-no-side-effect': '取消进行中的任务并确认没有残留写入',
    'cross-workspace-isolation': '跨工作区访问被隔离并确认原工作区不受影响'
  }
  return intents[template] ?? `${category} workflow ${template}`
}

function acceptanceCriteriaFor(category) {
  if (category === 'recovery-boundary') return '记录预期错误或恢复路径，并由独立 oracle 核验副作用和最终状态'
  if (category === 'cross-domain') return '核对跨域数据身份、来源字段、最终交付物和目标状态'
  return '核对每个 required action 的调用结果、关键参数和独立读回状态'
}

function toEvalCase(entry) {
  const actionPlans = entry.requiredActions
    .map((actionId) => plans.find((plan) => plan.actionId === actionId))
    .filter(Boolean)
  const expected = {
    ...(entry.workflowType === 'cross-domain'
      ? { requiredDomains: entry.packageOwners }
      : { domain: entry.packageOwners[0] }),
    mustDiscover: entry.requiredActions,
    requiredActions: entry.requiredActions,
    allowedActions: entry.requiredActions,
    authorization: Object.fromEntries(actionPlans.map((plan) => [
      plan.actionId,
      plan.approval === 'confirmation' ? 'confirmation' : 'allow'
    ])),
    invocation: Object.fromEntries(entry.requiredActions.map((actionId) => [actionId, { success: true }])),
    arguments: Object.fromEntries(actionPlans.map((plan) => [
      plan.actionId,
      argumentExpectation(plan.inputShape)
    ])),
    taskSuccess: true
  }
  return {
    id: entry.id,
    query: entry.query,
    tags: entry.tags,
    workflowType: entry.workflowType,
    expected
  }
}

function argumentExpectation(inputShape) {
  const types = {}
  for (const [property, shape] of Object.entries(inputShape?.properties ?? {})) {
    if (typeof shape?.type !== 'string') continue
    if (['array', 'boolean', 'number', 'object', 'string', 'null'].includes(shape.type)) {
      types[property] = shape.type
    }
  }
  return {
    required: Array.isArray(inputShape?.required) ? inputShape.required : [],
    types,
    values: {}
  }
}

function actionCountForOwners(requested, ownerCount) {
  return Math.max(1, Math.ceil(requested / ownerCount))
}

function selectActions(owner, offset, count, template, ownerIndex) {
  const ownerPlans = byOwner.get(owner) ?? []
  if (ownerPlans.length === 0) return []
  const preferredEffects = preferredEffectsFor(template, ownerIndex)
  const candidates = preferredEffects.length > 0
    ? ownerPlans.filter((plan) => preferredEffects.includes(plan.effect))
    : ownerPlans
  const pool = candidates.length > 0 ? candidates : ownerPlans
  return Array.from({ length: Math.min(count, pool.length) }, (_, index) => pool[(offset + index) % pool.length])
}

function preferredEffectsFor(template, ownerIndex) {
  if (template === 'no-capability-call') return []
  if (['read-state-and-report', 'read-empty-and-missing', 'resource-create-and-list', 'resource-update-and-read', 'version-create-and-compare', 'version-restore-and-verify', 'comment-and-thread-readback', 'provider-status-and-operation', 'artifact-to-preview', 'remote-to-preview', 'checkpoint-to-review'].includes(template)) return ['read']
  if (['write-and-readback', 'write-idempotency', 'resource-delete-and-absence', 'review-and-package', 'version-to-checkpoint', 'evidence-to-project', 'biology-to-evidence', 'browser-to-feedback', 'approval-denied', 'approval-allowed', 'cancel-no-side-effect', 'cross-workspace-isolation'].includes(template)) return ['workspace-write', 'external-write', 'destructive']
  if (['transform-and-validate', 'join-and-validate', 'compute-success-and-artifact', 'compute-blocked-and-diagnostics', 'research-to-plot', 'dataset-to-plot', 'workflow-to-artifact', 'paper-to-dataset', 'transient-timeout-recovery'].includes(template)) return ['compute']
  if (['preview-and-export', 'plot-to-review'].includes(template)) return ownerIndex === 0 ? ['read'] : ['workspace-write', 'external-write']
  if (['empty-result', 'expired-resource', 'persistent-provider-failure', 'idempotent-replay'].includes(template)) return ['read', 'compute', 'external-write']
  if (template === 'reasonable-alternative') return ['read', 'compute']
  return []
}

function fixtureStrategyFor(actionIds) {
  const effects = actionIds.map((actionId) => plans.find((plan) => plan.actionId === actionId)?.effect).filter(Boolean)
  if (effects.some((effect) => effect === 'external-write')) return 'isolated-provider-or-service-fixture'
  if (effects.some((effect) => effect === 'workspace-write' || effect === 'destructive')) return 'disposable-workspace-fixture'
  if (effects.includes('compute')) return 'package-owned-compute-fixture'
  return 'deterministic-readable-state-fixture'
}

function oracleStrategyFor(actionIds) {
  const effects = actionIds.map((actionId) => plans.find((plan) => plan.actionId === actionId)?.effect).filter(Boolean)
  if (effects.some((effect) => effect === 'external-write')) return 'controlled-service-receipt-and-state-readback'
  if (effects.some((effect) => effect === 'workspace-write' || effect === 'destructive')) return 'content-state-and-lineage-readback'
  if (effects.includes('compute')) return 'trace-closure-and-artifact-readback'
  return 'structured-value-and-state-readback'
}

function renderMarkdown(entries) {
  const counts = countBy(entries, (entry) => entry.category)
  const ready = entries.filter((entry) => entry.readiness === 'ready').length
  const lines = [
    '# Workflow expansion plan',
    '',
    `The expansion target is ${entries.length} workflows: ${formatCounts(counts)}. ${ready} are currently ready from package contributions; the rest remain planned and blocked until their fixture/oracle dependencies are implemented.`,
    'The executable case projection is `eval-cases/capability/workflow-expansion-cases.jsonl`; the plan file retains fixture, oracle and readiness metadata.',
    '',
    '| ID | Category | Business intent | Required actions | Owners | Readiness | Blocker |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...entries.map((entry) => `| \`${entry.id}\` | ${entry.category} | ${entry.businessIntent} | ${entry.requiredActions.map((actionId) => `\`${actionId}\``).join('<br>')} | ${entry.packageOwners.join(', ')} | ${entry.readiness} | ${entry.blocker ?? '—'} |`),
    '',
    'These are task contracts to implement and run. They do not count as live coverage until the Agent run and independent oracle evidence are persisted.',
    ''
  ]
  return lines.join('\n')
}

async function readJsonl(filePath) {
  const content = await readFile(filePath, 'utf8')
  return content.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSONL at ${path.relative(root, filePath)}:${index + 1}: ${error.message}`)
    }
  })
}

function countBy(values, selector) {
  return values.reduce((counts, value) => {
    const key = selector(value)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function formatCounts(counts) {
  return Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${value} ${key}`).join(', ')
}
