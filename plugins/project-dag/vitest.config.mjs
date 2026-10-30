import { fileURLToPath } from 'node:url'

export default {
  root: fileURLToPath(new URL('../../', import.meta.url)),
  cacheDir: process.env.PROJECT_DAG_TEST_CACHE,
  test: { include: ['plugins/project-dag/tests/*.test.ts'], environment: 'node' }
}
