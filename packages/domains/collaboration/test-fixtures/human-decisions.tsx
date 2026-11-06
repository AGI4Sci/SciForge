// Local-only UI acceptance fixture. Production page; simulated Cloud facts and writes.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts'
import { CollaborationWorkspacePage } from '../src/renderer/workspace/CollaborationWorkspacePage.js'
import '../src/renderer/workspace/CollaborationWorkspaceStructure.css'

const projectId = 'prj_HumanDecisionDemo01'
const userId = 'usr_HumanDecisionDemo01'
const ownerId = 'usr_HumanDecisionOwner1'
const executionId = 'exe_HumanDecisionDemo01'
const requirementsId = 'rqd_HumanDecisionDemo000001'
const taskId = canonicalTaskIdForRequirementsModule(requirementsId, 'item_HumanDecision001')
const at = '2026-11-01T00:00:00.000Z'
const members = [{ userId, displayName: '研究成员' }, { userId: ownerId, displayName: '项目负责人' }]
const request = { schemaVersion: 1, revision: 2, createdAt: at, updatedAt: at, type: 'human_needed',
  humanRequestId: 'hrq_HumanDecisionDemo01', projectId, context: { scope: 'worker_execution', taskId, executionId },
  targetUserId: userId, requestedByAgentId: 'agt_HumanDecisionDemo01', requiredAssurance: 'verified',
  prompt: '分析已经完成。是否允许将当前结果写入项目报告？',
  confirmableAction: { actionType: 'workspace.report.write', safeSummary: '更新 results/report.md 中的方法对比结果；保留原始数据和历史报告。', effect: 'workspace-write', actionDigest: 'a'.repeat(64) },
  status: 'pending', expiresAt: '2099-11-02T00:00:00.000Z' }
const task = { taskId, projectId, title: '比较方法 A 与基线 B', status: 'in_progress', revision: 4, currentExecutionId: executionId, currentExecutionState: 'needs_human' }
const dashboard = { projectId, taskId, schemaVersion: 1, type: 'dashboard_task_card', taskKind: 'task',
  lineage: { projectId, requirementsBaselineId: requirementsId, workItemId: 'item_HumanDecision001' }, title: task.title,
  workflowColumn: 'needs_human', contractExecution: 'needs_human', delivery: 'not_submitted', adoption: 'pending', contract: null,
  assigneeUserId: userId, assigneeDisplayName: '研究成员', executionId, unread: false, blocker: null, nextAction: null,
  plannedStartAt: null, plannedDueAt: null, observedAt: at, privateSessionAvailable: false, primaryAction: 'view' }
const project = { project: { projectId, ownerUserId: ownerId, revision: 7, displayName: '科研人工介入验收', goal: '在确切版本上作出决定并可靠继续', status: 'active', coordinatorAuthorityEpoch: 2, executionAuthorityEpoch: 5 },
  memberUsers: members, memberships: members.map(member => ({ ...member, projectMembershipId: `pmb_${member.userId}`, state: 'active', revision: 1 })),
  requirementsDraft: null, confirmedRequirements: { requirementsDocumentId: requirementsId, projectId, inputReferences: [], revision: 3, documentRevision: 3,
    goalsDeliverables: '完成有对照的分析报告', inputsBoundaries: '保留原始数据', workModules: [{ planItemId: 'item_HumanDecision001', title: task.title, objective: '比较效果并说明不确定性', dependencyPlanItemIds: [] }], acceptanceCriteria: [], state: 'confirmed' },
  requirementsCompletion: null, tasks: [{ task, delivery: null, executions: [] }], offers: [], pendingHumanNeeded: [request], records: [], finalSummary: null, deliveryDrive: null,
  projectPlan: null, coordinatorTransferFeedback: null, workerGroups: [], legacyHistory: { readOnly: true, plans: [], tasks: [], executions: [] } }
const workspace = { connection: { state: 'ready', userId, deviceId: 'dev_HumanDecisionDemo01' }, projects: [project] }
const snapshot = { revision: 1, connection: { state: 'connected' }, providerOptions: [], managedContainers: [], projections: [], projects: [],
  dashboards: [{ projectId, projectName: project.project.displayName, tasks: [dashboard], activity: [], mentionableUsers: members, materialConflicts: [] }], queue: [], notifications: [], diagnostics: [] }
const writes: unknown[] = []
let release: (() => void) | undefined
const client = { readWorkspace: async () => structuredClone(workspace), answerHumanNeeded: async (input: unknown) => {
  writes.push(input)
  await new Promise<void>(resolve => { release = resolve })
  project.pendingHumanNeeded = []
  return structuredClone(workspace)
} }
Object.assign(window, { humanDecisionFixture: {
  writes, release: () => release?.(), advance: () => { dashboard.contractExecution = 'running'; task.currentExecutionState = 'running'; window.dispatchEvent(new Event('focus')) },
  change: () => { project.pendingHumanNeeded = [{ ...request, revision: 3, confirmableAction: { ...request.confirmableAction, actionDigest: 'b'.repeat(64) } }] },
  expire: () => { project.pendingHumanNeeded = [{ ...request, expiresAt: '2000-01-01T00:00:00.000Z' }]; window.dispatchEvent(new Event('focus')) },
  otherUser: () => { workspace.connection.userId = ownerId; window.dispatchEvent(new Event('focus')) }
} })
createRoot(document.getElementById('root')!).render(<CollaborationWorkspacePage coordinatorClient={client as never} collaborationClient={{ readStatus: async () => structuredClone(snapshot) } as never} />)
