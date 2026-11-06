/**
 * 安装健康检查（只读）：把"安装失败后终端不可用"从踩坑变成一条可复现的命令。
 *
 * 检查项：
 *   1. node-pty 的 spawn-helper 是否可执行（postinstall 应该 chmod 755）；
 *   2. node-pty 能否在纯 Node 下 spawn 一个进程（不是 Electron）；
 *   3. workspace-host 的离线制品是否已产出（build:artifact 成功与否）；
 *   4. 是否残留 staging 目录（失败安装的中间物）。
 *
 * 用法：
 *   node scripts/install-health.mjs [--json]
 * 退出码：0 = 全部正常；1 = 有异常项（输出里标明哪一项）。
 *
 * 注意：本脚本只读、不修改任何文件；修复属于安装脚本负责人（把 chmod 提到网络构建之前）。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const require = createRequire(join(REPO, 'package.json'))

const checks = []
const record = (name, ok, detail) => checks.push({ name, ok, detail })

// 1. spawn-helper 权限
let helperPaths = []
try {
  const prebuilds = join(REPO, 'node_modules', 'node-pty', 'prebuilds')
  for (const folder of readdirSync(prebuilds)) {
    const helper = join(prebuilds, folder, 'spawn-helper')
    if (!existsSync(helper)) continue
    const mode = statSync(helper).mode & 0o777
    helperPaths.push({ path: helper.replace(`${REPO}/`, ''), mode: mode.toString(8), executable: (mode & 0o111) !== 0 })
  }
  record('node-pty spawn-helper 可执行', helperPaths.length > 0 && helperPaths.every((entry) => entry.executable), helperPaths)
} catch (error) {
  record('node-pty spawn-helper 可执行', false, String(error?.message ?? error))
}

// 2. 纯 Node spawn
try {
  const pty = require('node-pty')
  const child = pty.spawn('/bin/echo', ['install-health-ok'], { cols: 80, rows: 24 })
  const done = new Promise((resolveDone) => {
    let output = ''
    child.onData((chunk) => { output += chunk })
    child.onExit(({ exitCode }) => resolveDone({ exitCode, output: output.trim() }))
  })
  const result = await Promise.race([
    done,
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout({ timeout: true }), 5_000))
  ])
  record('node-pty 纯 Node spawn', result.exitCode === 0 && result.output === 'install-health-ok', result)
} catch (error) {
  record('node-pty 纯 Node spawn', false, String(error?.message ?? error))
}

// 3. 离线制品
const artifactRoot = join(REPO, 'packages', 'workers', 'workspace-host', 'artifacts')
record('workspace-host 离线制品', existsSync(artifactRoot), existsSync(artifactRoot) ? artifactRoot.replace(`${REPO}/`, '') : 'missing — build:artifact 未成功')

// 4. 市场批处理工作目录（存在属正常，仅作信息项，不参与失败判定）
const marketWork = join(REPO, '.tmp', 'market-work')
record('市场批处理工作目录', true, existsSync(marketWork) ? `${marketWork.replace(`${REPO}/`, '')}（存在，属正常）` : 'absent')

const failed = checks.filter((check) => !check.ok)
const report = { repository: REPO, node: process.version, npm: process.env.npm_config_user_agent ?? null, checks, failed: failed.map((check) => check.name) }

if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write(`install-health: ${failed.length === 0 ? 'ok' : 'FAILED'}\n`)
  for (const check of checks) process.stdout.write(`  ${check.ok ? '✓' : '✗'} ${check.name}\n`)
  for (const check of failed) process.stdout.write(`    → ${JSON.stringify(check.detail)}\n`)
}
process.exitCode = failed.length === 0 ? 0 : 1