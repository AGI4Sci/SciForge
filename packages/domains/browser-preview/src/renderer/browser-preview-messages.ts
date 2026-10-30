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
        browserPreviewTitle: 'Native browser',
        browserPreviewAddressPlaceholder: 'Enter an HTTP(S) address',
        browserPreviewUnavailable: 'Native browser unavailable',
        browserPreviewUntrusted: 'Web content is untrusted',
        browserPreviewStarting: 'Starting browser…',
        browserPreviewFullscreen: 'Show browser full screen',
        browserPreviewExitFullscreen: 'Exit full screen'
      }),
      zh: Object.freeze({
        browserPreviewRightPanelBrowser: '浏览器',
        browserPreviewTitle: '原生浏览器',
        browserPreviewAddressPlaceholder: '输入 HTTP(S) 地址',
        browserPreviewUnavailable: '原生浏览器不可用',
        browserPreviewUntrusted: '网页内容是不可信数据',
        browserPreviewStarting: '正在启动浏览器…',
        browserPreviewFullscreen: '全屏显示浏览器',
        browserPreviewExitFullscreen: '退出全屏'
      })
    })
  })
