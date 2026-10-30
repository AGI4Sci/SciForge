import { beforeEach, describe, expect, it, vi } from 'vitest'

const setName = vi.fn()
const setAppUserModelId = vi.fn()

vi.mock('electron', () => ({
  app: {
    setName,
    setAppUserModelId
  }
}))

describe('app identity bootstrap', () => {
  beforeEach(() => {
    setName.mockReset()
    setAppUserModelId.mockReset()
    vi.resetModules()
  })

  it('calls app.setName with the SciForge product identity', async () => {
    const { configureAppIdentity, APP_PRODUCT_NAME } = await import('./app-identity')
    configureAppIdentity()
    expect(setName).toHaveBeenCalledTimes(1)
    expect(setName).toHaveBeenCalledWith(APP_PRODUCT_NAME)
    expect(APP_PRODUCT_NAME).toBe('SciForge')
  })

  it('does not call app.setAppUserModelId (caller responsibility on win32)', async () => {
    // setAppUserModelId 仍然由 main/index.ts 里的 win32 分支调用,
    // 这里只验证 configureAppIdentity 自己不重复设置。
    const { configureAppIdentity } = await import('./app-identity')
    configureAppIdentity()
    expect(setAppUserModelId).not.toHaveBeenCalled()
  })
})
