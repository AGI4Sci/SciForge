import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const output = join(root, 'dist')
await rm(output, { recursive: true, force: true })
await mkdir(dirname(join(output, 'main.mjs')), { recursive: true })
await cp(join(root, 'src', 'main.mjs'), join(output, 'main.mjs'))
await cp(join(root, 'src', 'ui'), join(output, 'ui'), { recursive: true })
console.log(`Built SciForge plugin into ${output}`)
