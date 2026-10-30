let active = false

export async function activate() {
  active = true
}

export async function deactivate() {
  active = false
}

export async function dispose() {
  await deactivate()
}

export function getRendererContributions() {
  return [{
    id: 'example-plugin.panel',
    kind: 'panel',
    title: active ? 'Example Plugin' : 'Example Plugin (inactive)'
  }]
}
