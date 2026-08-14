type PdfCMapAssetLoader = () => Promise<string>

type PdfCMapFetchResult = {
  cMapData: Uint8Array
  isCompressed: boolean
}

const PDF_CMAP_ASSET_LOADERS = import.meta.glob<string>(
  '../../../../../node_modules/pdfjs-dist/cmaps/*.bcmap',
  {
    import: 'default',
    query: '?inline'
  }
)

function cMapNameFromAssetPath(path: string): string {
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  return fileName.endsWith('.bcmap') ? fileName.slice(0, -'.bcmap'.length) : fileName
}

const PDF_CMAP_LOADER_BY_NAME = new Map<string, PdfCMapAssetLoader>(
  Object.entries(PDF_CMAP_ASSET_LOADERS).map(([path, loader]) => [
    cMapNameFromAssetPath(path),
    loader
  ])
)

function bytesFromInlineAsset(assetUrl: string): Uint8Array {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(assetUrl)
  if (!match) throw new Error('Bundled PDF CMap asset was not inlined as base64 data.')
  const binary = globalThis.atob(match[1])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Supplies PDF.js with its complete packed Adobe CMap set from the renderer
 * bundle. Dynamic imports keep the maps lazy while `?inline` makes loading
 * independent of HTTP versus packaged `file:` renderer URLs.
 */
export class BundledPdfCMapReaderFactory {
  async fetch({ name }: { name?: unknown }): Promise<PdfCMapFetchResult> {
    if (typeof name !== 'string' || !name) {
      throw new Error('PDF CMap name must be specified.')
    }
    const load = PDF_CMAP_LOADER_BY_NAME.get(name)
    if (!load) throw new Error(`Bundled PDF CMap is unavailable: ${name}`)
    return {
      cMapData: bytesFromInlineAsset(await load()),
      isCompressed: true
    }
  }
}

export function pdfJsRendererOptions(): {
  CMapReaderFactory: typeof BundledPdfCMapReaderFactory
  cMapPacked: true
  isEvalSupported: false
  useSystemFonts: true
} {
  return {
    CMapReaderFactory: BundledPdfCMapReaderFactory,
    cMapPacked: true,
    isEvalSupported: false,
    useSystemFonts: true
  }
}
