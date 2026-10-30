import { app } from 'electron'
export { APP_PRODUCT_NAME } from '../shared/app-brand'
import { APP_PRODUCT_NAME } from '../shared/app-brand'

/**
 * 在 main 进程最早期调用,把 app 的对外名称设好。
 * `app.setName()` 会覆盖 `app.getName()` 的返回值(优先于 package.json#name
 * 字段),并影响 BrowserWindow 默认 title、通知、托盘等所有用 `app.getName()`
 * 拿名字的地方。要尽早调用,免得启动早期就拿走了旧值。
 *
 * Windows 平台专属的 `app.setAppUserModelId()` 不在这里调 —— 它是 win32
 * 专用的,放在 main/index.ts 的 win32 分支里更直观。
 */
export function configureAppIdentity(): void {
  app.setName(APP_PRODUCT_NAME)
}
