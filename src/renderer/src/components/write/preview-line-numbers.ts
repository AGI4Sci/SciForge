import type { Root } from 'hast'

/** Preserve source locations without inserting text into copy/annotation ranges. */
export function rehypePreviewSourceLines(sourceLines: readonly number[] = []): (tree: Root) => void {
  return (tree) => {
    tree.children = tree.children.map((node) => {
      if (node.type !== 'element' || !node.position) return node
      const line = sourceLines[node.position.start.line - 1] ?? node.position.start.line
      return {
        type: 'element', tagName: 'div',
        properties: { 'data-preview-line-number': String(line) },
        children: [node]
      }
    })
  }
}
