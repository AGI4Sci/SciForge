/** A clock notification, never an execution grant. The package owns durable intent,
 * restores it on activation and revalidates authority when the callback fires. */
export type DomainMainWakeupsHost = Readonly<{
  schedule(at: string, wake: () => void): () => void
}>
