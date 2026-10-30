import { SiYuanClient } from '../src/main/client.js'
import { runSiYuanSmoke } from '../src/main/smoke.js'

async function main() {
  const client = new SiYuanClient({
    baseUrl: process.env.SIYUAN_BASE_URL ?? '',
    token: process.env.SIYUAN_API_TOKEN ?? ''
  })
  if (!process.argv.includes('--write')) {
    console.log(JSON.stringify({ version: await client.version(), notebooks: await client.listNotebooks() }, null, 2))
    return
  }
  const notebook = process.env.SIYUAN_TEST_NOTEBOOK_ID
  if (!notebook) throw new Error('Set SIYUAN_TEST_NOTEBOOK_ID before running --write.')
  console.log(JSON.stringify(await runSiYuanSmoke(client, notebook), null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SiYuan smoke failed.')
  process.exitCode = 1
})
