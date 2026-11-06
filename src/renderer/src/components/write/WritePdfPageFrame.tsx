import './preview-line-numbers.css'
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
  children,
  lineNumbers = []
}: {
  pageElementRef?: RefObject<HTMLDivElement | null>
  pageNumber: number
  rendered: boolean
  pageSize: PdfPageDisplaySize
  children?: ReactNode
  lineNumbers?: readonly number[]
}): ReactElement {
  return (
    <div className="relative shrink-0 pl-12" style={{ width: pageSize.width + 48, height: pageSize.height }}>
      {rendered ? <div aria-hidden="true" className="preview-line-gutter absolute left-0 top-0 h-full w-10">
        {lineNumbers.map((top, index) => <span
          key={index}
          data-preview-line-number={`${pageNumber}:${index + 1}`}
          className="absolute left-0 w-full"
          style={{ top }}
        />)}
      </div> : null}
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
    </div>
  )
}
