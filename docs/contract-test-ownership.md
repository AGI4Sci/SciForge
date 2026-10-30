# Client and cloud contract tests

Run `npm run contracts:test` for client-owned delivery, CI routing, bootstrap and
current Identity CONTEXT/ADR contracts. The root pretest and Collaboration CI invoke
this entrypoint without removing any existing pretest stages.

The closed cloud repository runs `npm run test:contracts` through `test:scripts` and
cloud CI. It owns Keycloak realm/Compose assertions, exact private development
endpoint defaults and the retired deployment-service assertions. Historical
OpenSpec/PR78 acceptance assertions and original hash-bound source inputs live in
its `tests/contracts/history` owner. They remain checked as historical evidence,
not declared automatically obsolete or promoted to current acceptance.

The public workflow keeps full application/typecheck/domain/platform and Electron
smoke requirements. Configuration assertions do not mean those heavyweight or
credential-dependent jobs have run locally. No private deployment defaults or
private source history are required in this client.
