// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import i18n from '../i18n'
import { describeRuntimeError, formatRuntimeError } from '../lib/format-runtime-error'
import { RuntimeBanner } from './RuntimeBanner'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined

beforeEach(async () => {
  await i18n.changeLanguage('en')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
})

async function renderBanner(props: Partial<Parameters<typeof RuntimeBanner>[0]> = {}): Promise<void> {
  await act(async () => {
    root?.render(
      <RuntimeBanner
        message="unexpected failure"
        runtimeReady
        stageInsetClass=""
        t={(key, options) => i18n.t(`common:${key}`, options)}
        onOpenSettings={() => undefined}
        onRetryConnection={() => undefined}
        {...props}
      />
    )
  })
}

it('exposes an accessible close action without retrying the failure', async () => {
  let dismissed = 0
  await renderBanner({ onDismiss: () => { dismissed += 1 } })
  const close = container?.querySelector<HTMLButtonElement>('[data-testid="runtime-error-dismiss"]')
  expect(close?.getAttribute('aria-label')).toBe(i18n.t('common:close'))
  await act(async () => close?.click())
  expect(dismissed).toBe(1)
})

it('renders the retried rate-limit failure with a retry action', async () => {
  const raw = 'unexpected status 429 Too Many Requests: {"code":"upstream_http_429"}'
  const view = describeRuntimeError(new Error(raw))
  let retried = 0

  await renderBanner({
    message: view.summary,
    detail: view.detail,
    onRetryTurn: { label: i18n.t('common:runtimeRetryFailedTurn'), onClick: () => { retried += 1 } }
  })

  expect(container?.textContent).toContain(i18n.t('common:runtimeUpstreamRateLimited'))
  const retry = container?.querySelector<HTMLButtonElement>('[data-testid="runtime-error-retry-turn"]')
  expect(retry?.textContent).toContain(i18n.t('common:runtimeRetryFailedTurn'))

  await act(async () => retry?.click())
  expect(retried).toBe(1)
})

it('renders the retried timeout failure in Chinese with the retry action', async () => {
  await i18n.changeLanguage('zh')
  const summary = formatRuntimeError(new Error('{"code":"upstream_timeout","message":"Upstream request timed out."}'))

  await renderBanner({
    message: summary,
    onRetryTurn: { label: i18n.t('common:runtimeRetryFailedTurn'), onClick: () => undefined }
  })

  expect(container?.textContent).toContain('模型服务响应超时，已自动重试仍失败')
  expect(container?.querySelector('[data-testid="runtime-error-retry-turn"]')?.textContent)
    .toContain(i18n.t('common:runtimeRetryFailedTurn'))
})
