import { useEffect, useMemo, useRef } from 'react'

/**
 * Returns a referentially stable callback that always invokes the latest
 * render's closure.
 *
 * Renderer subtrees such as the workspace preview panel re-render whenever an
 * ancestor re-renders. Handing an inline callback across a memoized boundary
 * would otherwise invalidate that boundary on every ancestor render, which
 * makes expensive consumers (image loading, markdown component mapping) redo
 * their work and reset visible state. Stabilizing the identity keeps memoized
 * boundaries intact while preserving "latest closure" semantics.
 */
export function useStableCallback<Args extends unknown[]>(
  callback: ((...args: Args) => void) | undefined
): (...args: Args) => void {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useMemo(() => (...args: Args): void => {
    callbackRef.current?.(...args)
  }, [])
}