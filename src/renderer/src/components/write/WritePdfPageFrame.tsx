import type {
  ReactElement,
  ReactNode,
  RefObject
} from 'react'

const DEFAULT_PDF_PAGE_WIDTH = 612
const DEFAULT_PDF_PAGE_HEIGHT = 792

export type PdfPageDisplaySize = {
  width: number
  height: number
}

export function pdfPageDisplaySize(
  pageBaseSizes: ReadonlyMap<number, PdfPageDisplaySize>,
  page: number,
  scale: number
): PdfPageDisplaySize {
  const baseSize = pageBaseSizes.get(page) ?? pageBaseSizes.get(1) ?? {
    width: DEFAULT_PDF_PAGE_WIDTH,
    height: DEFAULT_PDF_PAGE_HEIGHT
  }
  return {
    width: baseSize.width * scale,
    height: baseSize.height * scale
  }
}

export function WritePdfPageFrame({
  pageElementRef,
  pageNumber,
  rendered,
  pageSize,
  children
}: {
  pageElementRef?: RefObject<HTMLDivElement | null>
  pageNumber: number
  rendered: boolean
  pageSize: PdfPageDisplaySize
  children?: ReactNode
}): ReactElement {
  return (
    <div
      ref={pageElementRef}
      aria-hidden={rendered ? undefined : 'true'}
      className={rendered ? 'write-pdf-page' : 'write-pdf-page bg-white dark:bg-neutral-900'}
      data-write-pdf-page={rendered ? pageNumber : undefined}
      data-write-pdf-page-placeholder={rendered ? undefined : pageNumber}
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      {rendered ? children : null}
    </div>
  )
}
