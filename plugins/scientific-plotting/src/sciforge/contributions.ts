/** Package-owned SciForge surface, discovered through the public plugin contract. */
export function getRendererContributions() {
  return [{ id: 'scientific-figures', kind: 'panel' as const, title: '科研图件' }]
}
