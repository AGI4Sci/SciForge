import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const uiPath = new URL('../ui/index.html', import.meta.url)

test('Project DAG iframe renders non-quantitative update telemetry as indeterminate', async () => {
  const html = await readFile(uiPath, 'utf8')

  assert.doesNotMatch(html, /(?:68|86)%/)
  assert.doesNotMatch(html, /aria-valuenow\s*=/)
  assert.doesNotMatch(html, /progress-percent/)
  assert.match(html, /id="progress-phase"/)
  assert.match(html, /`阶段 \$\{job\.status\}`/)
  assert.match(html, /已尝试 \$\{Number\(job\.attempts\|\|0\)}/)
  assert.match(html, /job\.last_error/)
  assert.match(html, /track\.hidden=failed/)
  assert.match(html, /classList\.toggle\('indeterminate',!failed\)/)
  assert.match(html, /removeAttribute\('aria-valuenow'\)/)
})

test('Project DAG UI labels machine checks as structural rather than scientific approval', async () => {
  const html = await readFile(uiPath, 'utf8')

  assert.doesNotMatch(html, /机器检查足以支持现阶段使用/u)
  assert.doesNotMatch(html, /机器检查足以处理当前 Snapshot/u)
  assert.match(html, /结构、模式与路径检查已完成/u)
  assert.match(html, /不代表科学结论已获独立验证或批准/u)
  assert.match(html, /不构成科学批准/u)
})

test('Project DAG keeps native Evidence conclusions visible as typed Project Claims', async () => {
  const html = await readFile(uiPath, 'utf8')

  assert.match(
    html,
    /function projectClaimLabel\(value\)\{return object\(value\)\.claim_type==='conclusion'\?'Conclusion':'Claim'\}/
  )
  assert.match(html, /claim_type=conclusion 显示为 Conclusion/)
  assert.match(html, /model\.counts\.conclusion\} Conclusion/)
  assert.match(html, /projectClaimLabel\(detail\)/)
})

test('Project DAG exports only visible canonical rerun specs', async () => {
  const html = await readFile(uiPath, 'utf8')

  assert.match(html, /function rerunExportModel\(provenance\)/)
  assert.match(html, /schemaVersion==='sciforge\.rerun\.v1'/)
  assert.match(html, /data-download-rerun-spec=/)
  assert.match(html, /\.sciforge-rerun\.json/)
  assert.match(html, /function downloadRerunSpec\(spec,reference\)/)
  assert.match(html, /object\(reference\)\.accessLevel!=='public'/)
  assert.match(html, /typeof object\(spec\)\.specDigest!=='string'/)
  assert.match(html, /object\(reference\)\.specDigest!==object\(spec\)\.specDigest/)
  assert.match(html, /访问策略仅允许显示不可变哈希引用，不提供下载/)

  const pureScript = html.match(
    /<script id="claim-detail-pure">([\s\S]*?)<\/script>/
  )?.[1]
  assert.ok(pureScript)
  const context = {
    input: {
      rerunSpecs: [
        { schemaVersion: 'sciforge.rerun.v1', specDigest: 'sha256:visible' },
        { schemaVersion: 'sciforge.rerun.v1', specDigest: 'sha256:restricted' },
        { schemaVersion: 'private.rerun.v9', specDigest: 'sha256:invalid' }
      ],
      rerunSpecReferences: [
        { specDigest: 'sha256:visible', accessLevel: 'public' },
        { specDigest: 'sha256:restricted', accessLevel: 'restricted' }
      ]
    },
    result: undefined as unknown
  }
  runInNewContext(`${pureScript};result=rerunExportModel(input)`, context)
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.result)),
    {
      exports: [{
        spec: { schemaVersion: 'sciforge.rerun.v1', specDigest: 'sha256:visible' },
        reference: { specDigest: 'sha256:visible', accessLevel: 'public' }
      }],
      specs: [{ schemaVersion: 'sciforge.rerun.v1', specDigest: 'sha256:visible' }],
      restrictedRefs: [
        { specDigest: 'sha256:restricted', accessLevel: 'restricted' }
      ]
    }
  )
})

test('Project DAG rechecks rerun reference access before downloading', async () => {
  const html = await readFile(uiPath, 'utf8')
  const downloadSource = html.match(
    /function downloadRerunSpec\(spec,reference\)\{[\s\S]*?\n\}/
  )?.[0]
  assert.ok(downloadSource)
  let blobCount = 0
  let clickCount = 0
  const downloadContext = {
    spec: { schemaVersion: 'sciforge.rerun.v1', specDigest: 'sha256:restricted' },
    reference: { specDigest: 'sha256:restricted', accessLevel: 'restricted' },
    Blob: class {
      constructor() { blobCount += 1 }
    },
    URL: {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => undefined
    },
    document: {
      createElement: () => ({
        href: '', download: '', click: () => { clickCount += 1 }
      })
    },
    setTimeout: (callback: () => void) => callback()
  }
  runInNewContext(
    `const object=value=>value&&typeof value==='object'?value:{};${downloadSource};downloadRerunSpec(spec,reference)`,
    downloadContext
  )
  assert.equal(blobCount, 0)
  assert.equal(clickCount, 0)
  downloadContext.reference.accessLevel = 'public'
  runInNewContext('downloadRerunSpec(spec,reference)', downloadContext)
  assert.equal(blobCount, 1)
  assert.equal(clickCount, 1)
})
