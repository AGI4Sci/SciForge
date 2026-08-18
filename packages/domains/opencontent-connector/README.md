# OpenContent Connector

Owns existing-account enrollment, Principal-bound connection state, secure Token use, pinned OpenContent schemas, and main-process transport. It exposes no Content Space or Shared Documents business semantics.

The connector has no built-in service endpoint. Deployments configure the
Provider-owned `SCIFORGE_OPENCONTENT_BASE_URL` environment variable with the
HTTPS OpenContent origin. When it is absent, connection attempts fail closed
as unavailable and never fall back to a development service.
