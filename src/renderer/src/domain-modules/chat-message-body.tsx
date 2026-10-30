import { Component, type ReactElement, type ReactNode } from 'react'
import type { DomainRendererChatMessageRenderContext } from '@sciforge/domain-sdk/renderer'
import type { ChatMessageContributionRegistry } from './chat-message-slot'

/** Only the existing message body is replaceable; framework controls stay outside. */
export function ChatMessageBody({ registry, context, children }: {
  registry: ChatMessageContributionRegistry
  context: DomainRendererChatMessageRenderContext
  children: ReactElement
}): ReactElement {
  const body = registry.resolve(context)
  if (body === null) return children
  return (
    <MessageBodyBoundary key={context.message.id} context={context} fallback={children}>
      {body}
    </MessageBodyBoundary>
  )
}

class MessageBodyBoundary extends Component<{
  context: DomainRendererChatMessageRenderContext
  fallback: ReactElement
  children: ReactNode
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidUpdate(previous: Readonly<MessageBodyBoundary['props']>): void {
    if (this.state.failed && (
      previous.context.message.rawText !== this.props.context.message.rawText ||
      previous.context.turnLifecycle?.revision !== this.props.context.turnLifecycle?.revision
    )) this.setState({ failed: false })
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
