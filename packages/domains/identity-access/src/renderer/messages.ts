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
      cancel: 'Cancel',
      dismiss: 'Not now',
      optionalNotice: 'A Local Account is optional. Local features work without one.',
      assuranceNotice: 'This name is only used for local attribution. It is not secure authentication and does not isolate Workspaces, chats, settings, API keys, or tool data.',
      createConfirmation: 'Create a new Local Account with this display name?',
      confirmCreation: 'Confirm creation',
      recoveryTitle: 'Local Identity could not be opened',
      recoveryNotice: 'SciForge local features remain available. Recovery first creates a verified backup, then resets only Local Account identity data.',
      reset: 'Back up and reset Identity',
      resetConfirmation: 'Type RESET LOCAL IDENTITY to confirm',
      backupCreated: 'Backup created at: {{path}}',
      retry: 'Retry',
      loading: 'Loading…',
      cloudTitle: 'SciForge Cloud',
      cloudNotice: 'Sign in to let this Desktop access SciForge Cloud projects.',
      cloudLoading: 'Loading cloud identity…',
      cloudSignedOut: 'Not signed in to Cloud',
      cloudLocalAccountRequired: 'Select or create a Local Account first.',
      cloudSignIn: 'Sign in with browser',
      cloudSignOut: 'Sign out',
      cloudReauthenticate: 'Sign in again',
      cloudEnrollDevice: 'Connect this Desktop',
      cloudRevokeDevice: 'Disconnect this Desktop',
      cloudDeviceActive: 'This Desktop is connected',
      cloudDeviceRevoked: 'This Desktop is disconnected',
      cloudDeviceEnrolling: 'Connecting this Desktop',
      cloudDeviceNotEnrolled: 'This Desktop is not connected',
      cloudDeviceError: 'This Desktop has a connection issue',
      cloudErrorProviderUnavailable: 'Cannot connect to the SciForge login service. Check your network and try again.',
      cloudErrorLoginFailed: 'Sign-in did not complete. Try again.',
      cloudErrorSessionExpired: 'Your sign-in has expired. Sign in again.',
      cloudErrorConfiguration: 'The login service is misconfigured. Contact your administrator.',
      cloudErrorGeneric: 'Cloud sign-in failed. Try again later.'
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
      cancel: '取消',
      dismiss: '暂不创建',
      optionalNotice: '本地账户可选；不登录也能使用本地功能。',
      assuranceNotice: '本地账户只用于本机归属标记，不是安全认证，也不会隔离工作区、聊天、设置、API Key 或工具数据。',
      createConfirmation: '确认使用此显示名称创建新的本地账户吗？',
      confirmCreation: '确认创建',
      recoveryTitle: '无法打开本地身份数据库',
      recoveryNotice: 'SciForge 的其他本地功能仍可使用。恢复操作会先生成并验证备份，然后仅重置本地账户身份数据。',
      reset: '备份并重置身份数据',
      resetConfirmation: '输入 RESET LOCAL IDENTITY 进行二次确认',
      backupCreated: '已创建备份：{{path}}',
      retry: '重试',
      loading: '加载中…',
      cloudTitle: 'SciForge 云端',
      cloudNotice: '登录后，这台设备才能访问 SciForge 云端项目。',
      cloudLoading: '正在加载云端身份…',
      cloudSignedOut: '尚未登录云端',
      cloudLocalAccountRequired: '请先选择或创建本地账户。',
      cloudSignIn: '浏览器登录',
      cloudSignOut: '退出登录',
      cloudReauthenticate: '重新登录',
      cloudEnrollDevice: '连接这台设备',
      cloudRevokeDevice: '断开这台设备',
      cloudDeviceActive: '这台设备已连接',
      cloudDeviceRevoked: '这台设备已断开',
      cloudDeviceEnrolling: '正在连接这台设备',
      cloudDeviceNotEnrolled: '这台设备尚未连接',
      cloudDeviceError: '这台设备连接异常',
      cloudErrorProviderUnavailable: '暂时无法连接登录服务，请检查网络后重试。',
      cloudErrorLoginFailed: '登录未完成，请重试。',
      cloudErrorSessionExpired: '登录已过期，请重新登录。',
      cloudErrorConfiguration: '登录服务配置异常，请联系管理员。',
      cloudErrorGeneric: '云端登录失败，请稍后重试。'
    })
  })
})

export type IdentityI18nResourceContribution = typeof identityI18nResourceContribution

// Separate from identityI18nResourceContribution: the overlay's own strings live in the
// 'identity' namespace, but the workbench top bar reads toolbar-action labels out of the
// default 'common' namespace (see WorkbenchTopBar.tsx / useTranslation(['common', 'settings'])).
// A key registered only under 'identity' would never resolve there, so the top-bar tooltip
// needs its own small entry merged into 'common'.
export const identityToolbarI18nResourceContribution = Object.freeze({
  namespace: 'common',
  resources: Object.freeze({
    en: Object.freeze({
      identityAccountToolbar: 'Account'
    }),
    zh: Object.freeze({
      identityAccountToolbar: '账户'
    })
  })
})

export type IdentityToolbarI18nResourceContribution = typeof identityToolbarI18nResourceContribution
