# OpenContent Connector

Owns existing-account enrollment, Principal-bound connection state, secure Token use, pinned OpenContent schemas, and main-process transport. It exposes no Content Space or Shared Documents business semantics.

The connector ships the reviewed `edoc2-test1-verification` profile as a
compile-time package asset. That profile permanently binds Provider Instance
`opencontent-edoc2-demo` to `https://test1.edoc2.com`; callers can select the
Instance but cannot inject or override its endpoint at runtime.
