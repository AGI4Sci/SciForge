export const identityI18nResourceContribution = Object.freeze({
  namespace: 'identity',
  resources: Object.freeze({
    en: Object.freeze({
      accountTitle: 'Local Account',
      login: 'Login',
      unavailable: 'Identity unavailable',
      createTitle: 'Create a Local Account',
      create: 'Create account',
      username: 'Display name',
      select: 'Select',
      rename: 'Rename',
      save: 'Save',
      exit: 'Exit account',
      close: 'Close',
      dismiss: 'Not now',
      optionalNotice: 'A Local Account is optional. All local features remain available without one.',
      assuranceNotice: 'This only selects a name for local attribution. It is not secure authentication and does not isolate Workspaces, chats, settings, API keys, or tool data.',
      createConfirmation: 'Create a new Local Account with this display name?',
      recoveryTitle: 'Local Identity could not be opened',
      recoveryNotice: 'SciForge local features remain available. Recovery first creates a verified backup, then resets only Local Account identity data.',
      reset: 'Back up and reset Identity',
      resetConfirmation: 'Type RESET LOCAL IDENTITY to confirm',
      backupCreated: 'Backup created at: {{path}}',
      retry: 'Retry',
      loading: 'Loading…'
    }),
    zh: Object.freeze({
      accountTitle: '本地账户',
      login: '登录',
      unavailable: '身份不可用',
      createTitle: '创建本地账户',
      create: '创建账户',
      username: '显示名称',
      select: '选择',
      rename: '重命名',
      save: '保存',
      exit: '退出账户',
      close: '关闭',
      dismiss: '暂不创建',
      optionalNotice: '本地账户是可选的；未登录时所有本地功能仍可使用。',
      assuranceNotice: '这里只是在本机选择一个用于归属标记的名称，不是安全认证，也不会隔离工作区、聊天、设置、API Key 或工具数据。',
      createConfirmation: '确认使用此显示名称创建新的本地账户吗？',
      recoveryTitle: '无法打开本地身份数据库',
      recoveryNotice: 'SciForge 的其他本地功能仍可使用。恢复操作会先生成并验证备份，然后仅重置本地账户身份数据。',
      reset: '备份并重置身份数据',
      resetConfirmation: '输入 RESET LOCAL IDENTITY 进行二次确认',
      backupCreated: '已创建备份：{{path}}',
      retry: '重试',
      loading: '加载中…'
    })
  })
})

export type IdentityI18nResourceContribution = typeof identityI18nResourceContribution
