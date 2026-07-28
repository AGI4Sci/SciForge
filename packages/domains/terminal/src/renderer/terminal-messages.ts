export type TerminalI18nResourceContribution = Readonly<{
  namespace: string
  resources: Readonly<Record<string, Readonly<Record<string, string>>>>
}>

export const terminalI18nResourceContribution: TerminalI18nResourceContribution =
  Object.freeze({
    namespace: 'common',
    resources: Object.freeze({
      en: Object.freeze({
        rightPanelTerminal: 'Terminal',
        terminalPanelTitle: 'Terminal',
        terminalRestart: 'Restart terminal',
        terminalNewTab: 'New terminal tab',
        terminalCloseTab: 'Close terminal tab',
        terminalTabMenuTitle: 'Terminal tab actions',
        terminalRenameTab: 'Rename terminal tab',
        terminalCloseOtherTabs: 'Close other terminal tabs',
        terminalCloseAllTabs: 'Close all terminal tabs',
        terminalTabTitle: 'Terminal {{index}}',
        terminalExitMessage: 'Process exited - click to restart',
        terminalUnavailable: 'Terminal unavailable'
      }),
      zh: Object.freeze({
        rightPanelTerminal: '终端',
        terminalPanelTitle: '终端',
        terminalRestart: '重启终端',
        terminalNewTab: '新建终端标签',
        terminalCloseTab: '关闭终端标签',
        terminalTabMenuTitle: '终端标签操作',
        terminalRenameTab: '重命名终端标签',
        terminalCloseOtherTabs: '关闭其他终端标签',
        terminalCloseAllTabs: '关闭全部终端标签',
        terminalTabTitle: '终端 {{index}}',
        terminalExitMessage: '进程已退出 - 点击重启',
        terminalUnavailable: '终端不可用'
      })
    })
  })
