# OpenContent Content Space Provider

Adapts the OpenContent Connector to Content Space without moving integration ownership into
Content Space.

- The main entry maps the Connector's token-free facade into the provider-neutral
  `ContentSpaceProvider` contract.
- The renderer entry contributes the Connector-owned enrollment fragment to the
  provider-neutral `content-space.provider-enrollment-view` slot.
- The adapter selects by Provider Kind and forwards the exact Provider Instance Ref chosen by
  Content Space. It never receives a token, password, endpoint, or connection ID.

The binding remains owned by the Connector and scoped to the current Local Account, this device,
and the selected Provider Instance. The external OpenContent account is not a SciForge identity.
