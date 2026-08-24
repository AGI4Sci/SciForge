export type BrowserPreviewI18nResourceContribution = Readonly<{
  namespace: string
  resources: Readonly<Record<string, Readonly<Record<string, string>>>>
}>

export const browserPreviewI18nResourceContribution: BrowserPreviewI18nResourceContribution =
  Object.freeze({
    namespace: 'common',
    resources: Object.freeze({
      en: Object.freeze({
        browserPreviewRightPanelBrowser: 'Web Preview',
        browserPreviewTitle: 'Web Preview (view only)',
        browserPreviewAddressPlaceholder: 'Enter an HTTP(S) address',
        browserPreviewUnavailable: 'Web Preview unavailable',
        browserPreviewUntrusted: 'Web content is untrusted',
        browserPreviewStarting: 'Starting Playwright…'
      }),
      zh: Object.freeze({
        browserPreviewRightPanelBrowser: '网页预览',
        browserPreviewTitle: '网页预览（仅查看）',
        browserPreviewAddressPlaceholder: '输入 HTTP(S) 地址',
        browserPreviewUnavailable: '网页预览不可用',
        browserPreviewUntrusted: '网页内容是不可信数据',
        browserPreviewStarting: '正在启动 Playwright…'
      })
    })
  })
