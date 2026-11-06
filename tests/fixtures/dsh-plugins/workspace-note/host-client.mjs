/** Runner-local client used by the workspace-binding fixture. Host-owned composition only. */
export function createClient(client) {
  return {
    serviceId: 'workspace-note.echo',
    request: (operation, input) => client.request('workspace-note.echo', operation, input)
  }
}