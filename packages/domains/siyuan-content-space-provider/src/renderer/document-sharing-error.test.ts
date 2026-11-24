import { expect, it } from 'vitest'
import { documentSharingErrorText } from './document-sharing-error.js'
const en = (_zh: string, english: string) => english
const zh = (chinese: string) => chinese
const wrapped = (reasonCode: string, reasonMessage: string) => ({ code: 'handler_failed', details: { reasonCode, reasonMessage } })
it('localizes the exact safe public capability failure in both languages', () => {
  const failure = wrapped('cloud_unavailable', 'Cloud rejection: kernel_response_invalid.')
  expect(documentSharingErrorText(failure, en)).toContain('could not process the document response')
  expect(documentSharingErrorText(failure, zh)).toContain('云端返回的文档格式暂时无法处理')
  expect(documentSharingErrorText(wrapped('cloud_rejected', 'Cloud rejection: revision_conflict.'), en)).toContain('sharing state changed')
})
it.each([
  new Error('Cloud rejection: kernel_response_invalid.'),
  wrapped('unknown', 'Cloud rejection: kernel_response_invalid.'),
  wrapped('cloud_unavailable', 'SECRET Cloud rejection: kernel_response_invalid.'),
  wrapped('cloud_unavailable', 'Cloud rejection: kernel_response_invalid. SECRET'),
  wrapped('cloud_unavailable', '<html>SECRET</html>'),
  { code: 'handler_failed', message: 'Cloud rejection: kernel_response_invalid.' }
])('never extracts a marker from arbitrary text or reflects server content', failure => {
  expect(documentSharingErrorText(failure, en)).toBe('Sharing could not be completed. Check the cloud connection and reopen the sharing panel.')
  expect(documentSharingErrorText(failure, zh)).not.toContain('SECRET')
})
it('preserves actionable local authentication and readiness errors', () => {
  expect(documentSharingErrorText(wrapped('identity_required', 'SECRET'), en)).toContain('Sign in')
  expect(documentSharingErrorText({ code: 'space_not_ready' }, en)).toContain('not ready')
})
