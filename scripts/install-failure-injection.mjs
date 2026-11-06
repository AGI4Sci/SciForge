/**
 * 安装失败注入（隔离副本，不污染工作环境）。
 *
 * 目的：验证 `scripts/postinstall.cjs` 的顺序缺陷——"网络构建失败 → 直接 process.exit
 * → node-pty 的 chmod 不执行"，以及修复后的期望行为（幂等修复）。
 *
 * 全部在 OS 临时目录内构造夹具，**不修改仓库 node_modules**：
 *   fixture/
 *     package.json                    最小占位
 *     scripts/postinstall.cjs         仓库里那份的拷贝
 *     node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper   644 的拷贝
 *     bin/npm, bin/npx                假 npm：按 FAKE_NPM_EXIT 返回 0/1
 *
 * 三个阶段：
 *   A 失败注入：FAKE_NPM_EXIT=1 → postinstall 退出 1，helper 仍是 644
 *   B 恢复正常：FAKE_NPM_EXIT=0 → postinstall 退出 0，helper 变 755
 *   C 幂等：再跑一次 → 仍退出 0、helper 仍 755
 *
 * 用法：node scripts/install-failure-injection.mjs [--json]
 * 退出码：0 = 全部断言成立；1 = 有断言不成立
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile as readFileBytes } from 'node:fs/promises'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PLATFORM = process.platform === 'win32' ? 'win32-x64' : `${process.platform}-${process.arch}`

const repoHelperSnapshot = async () => {
  const path = join(REPO, 'node_modules', 'node-pty', 'prebuilds', PLATFORM, 'spawn-helper')
  if (!existsSync(path)) return { exists: false }
  const bytes = await readFileBytes(path)
  return {
    exists: true,
    mode: ((await stat(path)).mode & 0o777).toString(8),
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}
const repoBefore = await repoHelperSnapshot()
const gitBefore = spawnSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim()
const checks = []
const record = (name, ok, detail = null) => checks.push({ name, ok: Boolean(ok), detail })
const report = { fixture: null, phases: [] }

const fixture = await mkdtemp(join(tmpdir(), 'postinstall-injection-'))
report.fixture = fixture
const helper = join(fixture, 'node_modules', 'node-pty', 'prebuilds', PLATFORM, 'spawn-helper')
const modeOf = async (path) => ((await stat(path)).mode & 0o777).toString(8)

try {
  await mkdir(join(fixture, 'scripts'), { recursive: true })
  await mkdir(dirname(helper), { recursive: true })
  await mkdir(join(fixture, 'bin'), { recursive: true })
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'postinstall-fixture', private: true, version: '0.0.0' }, null, 2))
  await cp(join(REPO, 'scripts', 'postinstall.cjs'), join(fixture, 'scripts', 'postinstall.cjs'))
  await writeFile(helper, '#!/bin/sh\nexit 0\n')
  await chmod(helper, 0o644)
  for (const tool of ['npm', 'npx']) {
    const path = join(fixture, 'bin', tool)
    await writeFile(path, '#!/bin/sh\nexit "${FAKE_NPM_EXIT:-0}"\n')
    await chmod(path, 0o755)
  }

  const runPostinstall = (fakeExit) => spawnSync(process.execPath, [join(fixture, 'scripts', 'postinstall.cjs')], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: `${join(fixture, 'bin')}:${process.env.PATH}`,
      FAKE_NPM_EXIT: String(fakeExit)
    }
  })

  // A. 失败注入
  const failed = runPostinstall(1)
  const modeAfterFailure = await modeOf(helper)
  report.phases.push({
    phase: 'A-failure-injection',
    exitCode: failed.status,
    tail: `${failed.stdout ?? ''}${failed.stderr ?? ''}`.trim().split('\n').slice(-3),
    helperMode: modeAfterFailure
  })
  // 必须是"假 npm 明确返回 1"，不能用 status!==0 把超时/信号也当成正常失败
  const strictFailure = failed.status === 1 && failed.signal === null
  record('注入失败时 postinstall 精确退出 1（非超时/信号）', strictFailure,
    { status: failed.status, signal: failed.signal, error: failed.error ? String(failed.error.message ?? failed.error) : null })
  record('失败信息明确（未伪装成功）', /agent support package build failed/i.test(`${failed.stdout}${failed.stderr}`), null)
  record('失败后 helper 仍不可执行', (parseInt(modeAfterFailure, 8) & 0o111) === 0, modeAfterFailure)

  // B. 恢复正常
  const recovered = runPostinstall(0)
  const modeAfterRecovery = await modeOf(helper)
  report.phases.push({ phase: 'B-recovered', exitCode: recovered.status, helperMode: modeAfterRecovery })
  record('恢复后 postinstall 退出 0（非信号）', recovered.status === 0 && recovered.signal === null, { status: recovered.status, signal: recovered.signal })
  record('恢复后 helper 可执行', (parseInt(modeAfterRecovery, 8) & 0o111) !== 0, modeAfterRecovery)

  // C. 幂等
  const again = runPostinstall(0)
  const modeAfterAgain = await modeOf(helper)
  report.phases.push({ phase: 'C-idempotent', exitCode: again.status, helperMode: modeAfterAgain })
  record('重复执行仍退出 0', again.status === 0, again.status)
  record('重复执行后 helper 仍可执行', (parseInt(modeAfterAgain, 8) & 0o111) !== 0, modeAfterAgain)

  // D. 仓库本身未被改动：前后对照（hash + 权限 + git 状态），不只检查最终可执行
  const repoAfter = await repoHelperSnapshot()
  const gitAfter = spawnSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim()
  report.phases.push({ phase: 'D-repo-untouched', before: repoBefore, after: repoAfter })
  record('仓库 helper 前后完全一致（sha256 + 权限）',
    JSON.stringify(repoBefore) === JSON.stringify(repoAfter),
    { before: repoBefore, after: repoAfter })
  record('工作树前后一致', gitBefore === gitAfter, gitBefore === gitAfter ? null : { gitBefore, gitAfter })
  record('脚本为隔离流程测试（不触碰真实安装）', true, 'fake npm + fixture helper')
} finally {
  await rm(fixture, { recursive: true, force: true })
}

const failedChecks = checks.filter((check) => !check.ok)
report.checks = checks
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write(`install-failure-injection: ${failedChecks.length === 0 ? 'ok' : 'FAILED'}\n`)
  for (const check of checks) process.stdout.write(`  ${check.ok ? '✓' : '✗'} ${check.name}${check.detail === null ? '' : ` — ${JSON.stringify(check.detail)}`}\n`)
}
process.exitCode = failedChecks.length === 0 ? 0 : 1