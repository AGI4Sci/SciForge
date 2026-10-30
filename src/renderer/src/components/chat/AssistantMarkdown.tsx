import type { ReactElement } from 'react'
import { lazy, memo, Suspense, useEffect } from 'react'
import { performanceMonitor } from '../../lib/performance-monitor'

const LazyStreamdownAssistant = lazy(() =>
  import('./StreamdownAssistant').then((module) => ({ default: module.StreamdownAssistant }))
)

function AssistantMarkdownComponent({
  text,
  streaming,
  className
}: {
  text: string
  streaming: boolean
  className?: string
}): ReactElement {
  const renderStartedAt = performanceMonitor.now()
  useEffect(() => {
    performanceMonitor.sample('react.commit.AssistantMarkdown', performanceMonitor.now() - renderStartedAt, {
      streaming,
      chars: text.length
    })
  })

  return (
    <Suspense
      fallback={
        <div className={className}>
          {text}
        </div>
      }
    >
      <LazyStreamdownAssistant text={text} streaming={streaming} className={className} />
    </Suspense>
  )
}

export const AssistantMarkdown = memo(AssistantMarkdownComponent)
