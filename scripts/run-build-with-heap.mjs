import { spawnSync } from 'node:child_process'

// The renderer needs more than Node's default ~2 GiB heap, while a 6 GiB cap
// can pressure an 8 GiB Linux workstation into swapping or being OOM-killed.
const BUILD_HEAP_MIB = 3072
const childArgs = process.argv.slice(2)

if (childArgs.length === 0) {
  throw new Error('Usage: node scripts/run-build-with-heap.mjs <entrypoint> [...args]')
}

const result = spawnSync(
  process.execPath,
  [`--max-old-space-size=${BUILD_HEAP_MIB}`, ...childArgs],
  {
    env: process.env,
    stdio: 'inherit'
  }
)

if (result.error) throw result.error
process.exitCode = result.status ?? 1
