export const PROJECT_COORDINATOR_TRANSLATION_NAMESPACE = 'common'

export const projectCoordinatorMessages = Object.freeze({
  en: Object.freeze({
    projectCoordinatorTitle: 'Project coordination',
    projectCoordinatorToolbar: 'Project coordination',
    projectCoordinatorCollapse: 'Collapse Project coordination',
    projectCoordinatorRefresh: 'Refresh coordination state',
    projectCoordinatorLoading: 'Reading Cloud coordination state…',
    projectCoordinatorEmpty: 'No authoritative data is available for this section.',
    projectCoordinatorNoProject: 'No Project is selected.',
    projectCoordinatorProject: 'Project',
    projectCoordinatorPlan: 'Project Plan',
    projectCoordinatorWorkers: 'Worker selection',
    projectCoordinatorTasks: 'Tasks',
    projectCoordinatorReviews: 'Result review',
    projectCoordinatorProvisioning: 'Content provisioning',
    projectCoordinatorIdentityRequired: 'Identity is required. Continue in the Identity surface.',
    projectCoordinatorDeviceRequired: 'An active Device is required. Continue in the Identity surface.',
    projectCoordinatorCloudUnavailable: 'The Cloud coordination service is unavailable.',
    projectCoordinatorProtocolUnavailable: 'The versioned Cloud coordination read model is not available.',
    projectCoordinatorReadFailed: 'Project coordination state could not be read.',
    projectCoordinatorCoordinator: 'Coordinator Agent',
    projectCoordinatorOwner: 'Owner User',
    projectCoordinatorRevision: 'Revision',
    projectCoordinatorPlanMissing: 'No Plan has been created.',
    projectCoordinatorExactAgent: 'Exact Agent',
    projectCoordinatorNoWorkers: 'No Worker candidates are visible.',
    projectCoordinatorNoTasks: 'No Tasks have been dispatched.',
    projectCoordinatorNoReviews: 'No results are awaiting review.',
    projectCoordinatorProvisioningNext: 'Next action',
    projectCoordinatorObservedAt: 'Observed',
    projectCoordinatorActiveTasks: '{{count}} active Tasks'
  }),
  zh: Object.freeze({
    projectCoordinatorTitle: 'Project 协调',
    projectCoordinatorToolbar: 'Project 协调',
    projectCoordinatorCollapse: '收起 Project 协调',
    projectCoordinatorRefresh: '刷新协调状态',
    projectCoordinatorLoading: '正在读取 Cloud 权威协调状态…',
    projectCoordinatorEmpty: '此分区暂无权威数据。',
    projectCoordinatorNoProject: '尚未选择 Project。',
    projectCoordinatorProject: 'Project',
    projectCoordinatorPlan: 'Project Plan',
    projectCoordinatorWorkers: 'Worker 选择',
    projectCoordinatorTasks: 'Task',
    projectCoordinatorReviews: '结果复审',
    projectCoordinatorProvisioning: '内容供应',
    projectCoordinatorIdentityRequired: '需要身份认证；请在 Identity 界面继续。',
    projectCoordinatorDeviceRequired: '需要有效 Device；请在 Identity 界面继续。',
    projectCoordinatorCloudUnavailable: 'Cloud 协调服务不可用。',
    projectCoordinatorProtocolUnavailable: '版本化 Cloud 协调读模型尚不可用。',
    projectCoordinatorReadFailed: '无法读取 Project 协调状态。',
    projectCoordinatorCoordinator: 'Coordinator Agent',
    projectCoordinatorOwner: 'Owner User',
    projectCoordinatorRevision: '修订',
    projectCoordinatorPlanMissing: '尚未创建 Plan。',
    projectCoordinatorExactAgent: '精确 Agent',
    projectCoordinatorNoWorkers: '没有可见的 Worker 候选。',
    projectCoordinatorNoTasks: '尚未分发 Task。',
    projectCoordinatorNoReviews: '没有等待复审的结果。',
    projectCoordinatorProvisioningNext: '下一步',
    projectCoordinatorObservedAt: '观测时间',
    projectCoordinatorActiveTasks: '{{count}} 个进行中的 Task'
  })
})

export const projectCoordinatorI18nResourceContribution = Object.freeze({
  namespace: PROJECT_COORDINATOR_TRANSLATION_NAMESPACE,
  resources: projectCoordinatorMessages
})

export type ProjectCoordinatorI18nResourceContribution =
  typeof projectCoordinatorI18nResourceContribution
