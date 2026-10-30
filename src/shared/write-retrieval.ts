import type {
  WriteRetrievalSnippet as WriteAssistRetrievalSnippet,
  WriteRetrievalSnippetLocation as WriteAssistRetrievalSnippetLocation,
  WriteRetrieveContextResult
} from '../../packages/workers/write-assist/src/contract'

type SuccessfulWriteAssistRetrieval = Extract<WriteRetrieveContextResult, { ok: true }>

export type WriteRetrievalSnippetLocation = WriteAssistRetrievalSnippetLocation

export type WriteRetrievalSnippet = Omit<WriteAssistRetrievalSnippet, 'resourceUri'>

export type WriteRetrievalContext = Pick<
  SuccessfulWriteAssistRetrieval,
  'source' | 'query' | 'keywords' | 'indexedFiles' | 'indexedChunks'
> & {
  snippets: WriteRetrievalSnippet[]
}

export type WriteRetrievalRequest = {
  workspaceRoot?: string
  currentFilePath?: string
  query: string
  maxSnippets?: number
  includeCurrentFile?: boolean
}

export type WriteRetrievalResult =
  | {
      ok: true
      context: WriteRetrievalContext | null
    }
  | {
      ok: false
      message: string
    }
