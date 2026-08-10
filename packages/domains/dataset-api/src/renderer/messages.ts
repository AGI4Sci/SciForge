export const datasetApiI18nResourceContribution = Object.freeze({
  namespace: 'common',
  resources: Object.freeze({
    en: {
      datasetResourceMetadata: 'Metadata',
      datasetResourceQuery: 'Query dataset',
      datasetResourceRawData: 'Raw data',
      datasetResourceDataset: 'Dataset',
      datasetResourceEndpoint: 'API endpoint',
      datasetResourceRequest: 'Request JSON',
      datasetResourceRequestHint: 'Edit API parameters here. Upstream values can be inserted with the variable picker.',
      datasetPlanName: 'Dataset processing plan',
      datasetPlanDurableHint: 'Immutable parameters · durable checkpoints',
      datasetPlanPrepare: 'Prepare',
      datasetPlanExecute: 'Execute',
      datasetPlanResume: 'Resume',
      datasetPlanDraftReady: 'Draft plan ready for review',
      datasetPlanConfirm: 'Confirm this plan',
      datasetPlanConfirming: 'Confirming…',
      datasetPlanConfirmed: 'Plan confirmed. Run this node again to execute it:',
      datasetPlanProgress: '{{completed}} / {{total}} steps completed',
      datasetPlanUseResume: 'Resume this run',
      datasetPlanRequestHint: 'Run Prepare, review and confirm the returned draft, then run the node again in Execute mode. Failed runs can continue from a verified checkpoint.'
    },
    zh: {
      datasetResourceMetadata: '元数据',
      datasetResourceQuery: '调用数据集',
      datasetResourceRawData: '原始数据',
      datasetResourceDataset: '选择数据集',
      datasetResourceEndpoint: 'API 端点',
      datasetResourceRequest: '请求 JSON',
      datasetResourceRequestHint: '在这里编辑 API 参数，也可通过变量选择器插入上游节点的值。',
      datasetPlanName: 'Dataset 数据处理计划',
      datasetPlanDurableHint: '参数不可变 · 持久检查点',
      datasetPlanPrepare: '准备',
      datasetPlanExecute: '执行',
      datasetPlanResume: '恢复',
      datasetPlanDraftReady: '草案已生成，请审核后确认',
      datasetPlanConfirm: '确认此计划',
      datasetPlanConfirming: '正在确认…',
      datasetPlanConfirmed: '计划已确认，请再次运行此节点执行：',
      datasetPlanProgress: '已完成 {{completed}} / {{total}} 步',
      datasetPlanUseResume: '从此运行恢复',
      datasetPlanRequestHint: '先运行“准备”，审核并确认返回的草案，再以“执行”模式重新运行此节点；失败后可从校验过的检查点继续。'
    }
  })
})

export type DatasetApiI18nResourceContribution = typeof datasetApiI18nResourceContribution
