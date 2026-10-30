/**
 * Returns the business-command projection used for idempotency comparison.
 *
 * `requestId` is transport correlation only: retries may legitimately use a
 * different value while preserving the same idempotent business command. No
 * other field is removed, so any business-body drift remains a conflict.
 */
export function idempotencyComparableCommandProjection<
  Command extends Readonly<Record<string, unknown>>
>(command: Command): Readonly<Omit<Command, 'requestId'>> {
  const { requestId: _requestId, ...comparable } = command
  return comparable
}
