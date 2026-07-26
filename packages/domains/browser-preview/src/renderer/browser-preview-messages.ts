export type BrowserPreviewI18nResourceContribution = Readonly<{
  namespace: string
  resources: Readonly<Record<string, Readonly<Record<string, string>>>>
}>

export const browserPreviewI18nResourceContribution: BrowserPreviewI18nResourceContribution =
  Object.freeze({
    namespace: 'common',
    resources: Object.freeze({
      en: Object.freeze({
        browserPreviewRightPanelBrowser: 'Browser',
        browserPreviewTitle: 'Playwright browser',
        browserPreviewAddressPlaceholder: 'Enter an HTTP(S) address',
        browserPreviewUnavailable: 'Playwright browser unavailable',
        browserPreviewUntrusted: 'Web content is untrusted',
        browserPreviewStarting: 'Starting Playwright…'
      }),
      zh: Object.freeze({
        browserPreviewRightPanelBrowser: '浏览器',
        browserPreviewTitle: 'Playwright 浏览器',
        browserPreviewAddressPlaceholder: '输入 HTTP(S) 地址',
        browserPreviewUnavailable: 'Playwright 浏览器不可用',
        browserPreviewUntrusted: '网页内容是不可信数据',
        browserPreviewStarting: '正在启动 Playwright…'
      })
    })
  })
