const { execFileSync } = require('node:child_process')
const { posix } = require('node:path')

const PRIVATE_PAYLOAD_ROOTS = Object.freeze([
  'internal',
  '.sciforge/internal-overlays',
  '.sciforge/private',
  'meeting_records'
])

function isPrivatePayloadPath(path) {
  if (typeof path !== 'string' || !path.trim()) return false
  const normalized = posix.normalize(
    path.replaceAll('\\', '/').replace(/^(?:\.\/)+/u, '')
  )
  return PRIVATE_PAYLOAD_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`)
  )
}

function loadTrackedPrivatePayloadPaths(projectRoot) {
  const pathspecs = PRIVATE_PAYLOAD_ROOTS.flatMap((root) => [root, `${root}/**`])
  return [...new Set(execFileSync(
    'git',
    ['ls-files', '-z', '--', ...pathspecs],
    { cwd: projectRoot, encoding: 'utf8' }
  ).split('\0').filter(Boolean))].sort()
}

module.exports = {
  isPrivatePayloadPath,
  loadTrackedPrivatePayloadPaths
}
