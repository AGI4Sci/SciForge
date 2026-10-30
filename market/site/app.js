/**
 * Market site behaviour.
 *
 * The site reads exactly the index the app reads (`../index.json`) and renders
 * what that file actually says — including the plugins it declines to offer and
 * why. It never upgrades an entry into something installable: if the index does
 * not list a plugin under `plugins`, the site shows it as not installable.
 *
 * The download link is the artifact the client verifies. A browser cannot install
 * a plugin, so the page says so instead of promising one-click install.
 */

const effectLabels = {
  read: '读取',
  compute: '计算',
  'workspace-write': '写入工作区',
  'external-write': '写入外部',
  destructive: '破坏性'
}

const state = { index: null, query: '', category: 'all' }

function element(id) {
  return document.getElementById(id)
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function artifactUrl(plugin) {
  return new URL(`../artifacts/${plugin.artifact.file}`, window.location.href).toString()
}

function renderCards() {
  const cards = element('cards')
  const needle = state.query.trim().toLowerCase()
  const plugins = (state.index?.plugins ?? []).filter((plugin) => {
    if (state.category !== 'all' && !(plugin.categories ?? []).includes(state.category)) return false
    if (!needle) return true
    return `${plugin.title} ${plugin.name} ${(plugin.categories ?? []).join(' ')}`.toLowerCase().includes(needle)
  })

  cards.innerHTML = ''
  if (plugins.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = state.index?.plugins?.length ? '没有匹配的插件。' : '当前索引没有可安装的插件。'
    cards.append(empty)
    return
  }

  for (const plugin of plugins) {
    const card = document.createElement('article')

    const title = document.createElement('h2')
    title.textContent = plugin.title || plugin.name
    card.append(title)

    const identity = document.createElement('div')
    identity.className = 'meta'
    identity.textContent = `${plugin.name} · ${plugin.version} · ${formatSize(plugin.artifact.sizeBytes)}`
    card.append(identity)

    const tags = document.createElement('div')
    tags.className = 'row'
    for (const category of plugin.categories ?? []) {
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = category
      tags.append(tag)
    }
    if (plugin.publisher) {
      const tag = document.createElement('span')
      tag.className = 'tag ok'
      tag.textContent = `发布者 ${plugin.publisher}`
      tags.append(tag)
    }
    const dshTag = document.createElement('span')
    dshTag.className = 'tag'
    dshTag.textContent = plugin.form
    tags.append(dshTag)
    card.append(tags)

    const list = document.createElement('dl')

    const addRow = (label, value) => {
      const dt = document.createElement('dt')
      dt.textContent = label
      const dd = document.createElement('dd')
      if (value instanceof Node) dd.append(value)
      else dd.textContent = value
      list.append(dt, dd)
    }

    const permissions = document.createElement('span')
    if ((plugin.tools ?? []).length === 0) {
      permissions.textContent = '未声明工具授权'
    } else {
      plugin.tools.forEach((tool, position) => {
        if (position > 0) permissions.append(document.createElement('br'))
        const code = document.createElement('code')
        code.textContent = `${tool.id}（${effectLabels[tool.effect] ?? tool.effect}）`
        permissions.append(code)
      })
    }
    addRow('权限', permissions)

    addRow('宿主依赖', (plugin.hostDependencies ?? []).length ? plugin.hostDependencies.join(', ') : '无')
    addRow('完整性', `SHA-256 ${plugin.artifact.sha256.slice(0, 16)}…`)

    const download = document.createElement('code')
    const link = document.createElement('a')
    link.href = artifactUrl(plugin)
    link.textContent = plugin.artifact.file
    link.setAttribute('download', '')
    download.append(link)
    addRow('制品', download)

    card.append(list)

    if (plugin.runtimeNote) {
      const note = document.createElement('p')
      note.className = 'meta'
      note.textContent = plugin.runtimeNote
      card.append(note)
    }

    cards.append(card)
  }
}

function renderCategories() {
  const select = element('category')
  const found = new Set()
  for (const plugin of state.index?.plugins ?? []) {
    for (const category of plugin.categories ?? []) found.add(category)
  }
  for (const category of [...found].sort()) {
    const option = document.createElement('option')
    option.value = category
    option.textContent = category
    select.append(option)
  }
}

function renderBlocked() {
  const section = element('blocked-section')
  const list = element('blocked')
  const blocked = state.index?.blocked ?? []
  list.innerHTML = ''
  if (blocked.length === 0) {
    section.hidden = true
    return
  }
  section.hidden = false
  for (const entry of blocked) {
    const item = document.createElement('li')
    const identity = document.createElement('div')
    identity.className = 'meta'
    identity.textContent = `${entry.name} · ${entry.version}`
    const reason = document.createElement('div')
    reason.textContent = entry.reason
    item.append(identity, reason)
    list.append(item)
  }
}

function renderMeta() {
  const meta = element('index-meta')
  if (!state.index) {
    meta.textContent = ''
    return
  }
  meta.textContent = [
    `索引生成于 ${state.index.generatedAt}`,
    `DSH 运行时 ${state.index.dshRuntimeVersion}`,
    `可安装 ${state.index.plugins.length}`,
    `暂不可安装 ${state.index.blocked.length}`
  ].join(' · ')
}

function renderInstallNote() {
  const note = element('install-note')
  note.textContent =
    '安装说明：浏览器无法直接安装插件。请下载制品后在 SciForge 的「扩展中心 → 市场」中安装，' +
    '或在应用内市场中直接点击安装；两种方式都由客户端校验摘要与发布者签名。'
  if (state.index) {
    const client = document.createElement('div')
    client.textContent = `应用内市场读取同一索引（format ${state.index.format}）。`
    note.append(client)
  }
}

async function main() {
  try {
    const response = await fetch('../index.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`索引返回 HTTP ${response.status}`)
    state.index = await response.json()
    if (!Array.isArray(state.index.plugins) || !Array.isArray(state.index.blocked)) {
      throw new Error('索引格式不符合预期')
    }
  } catch (error) {
    const cards = element('cards')
    cards.innerHTML = ''
    const failure = document.createElement('p')
    failure.className = 'empty error'
    failure.textContent = `无法读取索引：${error instanceof Error ? error.message : String(error)}。本地预览请用 HTTP 服务打开本页（见 market/site/README.md）。`
    cards.append(failure)
    return
  }
  renderMeta()
  renderCategories()
  renderCards()
  renderBlocked()
  renderInstallNote()

  element('query').addEventListener('input', (event) => {
    state.query = event.target.value
    renderCards()
  })
  element('category').addEventListener('change', (event) => {
    state.category = event.target.value
    renderCards()
  })
}

void main()